import { NextResponse, after } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getTeacherByUserId } from "@/lib/academy";
import { supabaseAdmin } from "@/lib/supabase";
import { createNotification } from "@/lib/notifications";
import { sendClassLifecycleEmail, lifecycleEmailsEnabled } from "@/lib/email/send";
import { syncTeacherCalendarAfterReschedule, removeTeacherCalendarEvents } from "@/lib/teacher-calendar-sync";
import { findTeacherConflicts } from "@/lib/teacher-conflicts";

const PLATFORM_URL = (process.env.PLATFORM_URL ?? "https://b2c.aprender-aleman.de").replace(/\/$/, "");

/**
 * PATCH /api/teacher/classes/{id}  — reschedule / edit una clase o su serie
 * DELETE /api/teacher/classes/{id}?scope=series — cancelar (soft)
 *
 * Ownership: caller must be the class's assigned teacher. Admins also
 * allowed. PATCH only works on classes with status='scheduled'.
 * Notifies participating students via email + in-app on both paths.
 *
 * scope="series" (decisión Gelfis 2026-08-24: los profes tienen control
 * total de sueltas Y series): aplica a ESTA clase y todas las
 * posteriores aún agendadas de la misma cadena de recurrencia. Para
 * scheduled_at se aplica el DELTA (nuevo − viejo) a cada instancia,
 * preservando el espaciado semanal — misma lógica que el admin. La
 * notificación al estudiante es UNA sola (resumen con nº de clases),
 * no un email por instancia.
 */

export const runtime = "nodejs";

const PatchBody = z.object({
  scope:           z.enum(["this", "series"]).default("this"),
  scheduledAt:     z.string().datetime().optional(),
  durationMinutes: z.coerce.number().int().min(15).max(240).optional(),
  title:           z.string().trim().min(2).max(200).optional(),
  topic:           z.string().trim().max(500).nullable().optional(),
}).refine(b => Object.keys(b).filter(k => k !== "scope").length > 0, { message: "no_changes" });

async function authorizeEditor(classId: string) {
  const session = await auth();
  if (!session?.user) return { ok: false, status: 401, body: { error: "unauthorized" } };
  const role = (session.user as { role?: string }).role;
  if (role !== "teacher" && role !== "admin" && role !== "superadmin") {
    return { ok: false, status: 403, body: { error: "forbidden" } };
  }

  const sb = supabaseAdmin();
  const { data: cls } = await sb
    .from("classes")
    .select("id, teacher_id, status, scheduled_at, duration_minutes, title, type, parent_class_id")
    .eq("id", classId)
    .maybeSingle();
  if (!cls) return { ok: false, status: 404, body: { error: "not_found" } };

  if (role === "teacher") {
    const me = await getTeacherByUserId((session.user as { id: string }).id);
    if (!me || me.id !== (cls as { teacher_id: string | null }).teacher_id) {
      return { ok: false, status: 403, body: { error: "not_your_class" } };
    }
  }
  return { ok: true as const, session, cls };
}

type ClsRow = {
  id: string; teacher_id: string | null; status: string; scheduled_at: string;
  duration_minutes: number; title: string; type: string; parent_class_id: string | null;
};

/** IDs de la serie desde el anchor hacia delante (solo agendadas). */
async function seriesTargetIds(anchor: ClsRow): Promise<string[]> {
  const sb = supabaseAdmin();
  const parentId = anchor.parent_class_id ?? anchor.id;
  const { data: siblings } = await sb
    .from("classes")
    .select("id")
    .or(`id.eq.${parentId},parent_class_id.eq.${parentId}`)
    .gte("scheduled_at", anchor.scheduled_at)
    .eq("status", "scheduled");
  const ids = ((siblings ?? []) as Array<{ id: string }>).map(r => r.id);
  if (!ids.includes(anchor.id)) ids.push(anchor.id);
  return ids;
}

export async function PATCH(
  req:    Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const a = await authorizeEditor(id);
  if (!a.ok) return NextResponse.json(a.body, { status: a.status });
  const cls = a.cls as ClsRow;
  if (cls.status !== "scheduled") {
    return NextResponse.json(
      { error: "bad_status", message: "Solo puedes reprogramar clases en estado 'agendada'." },
      { status: 400 },
    );
  }

  let raw: unknown;
  try { raw = await req.json(); }
  catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }

  const parsed = PatchBody.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_failed", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const changes = parsed.data;

  const sb = supabaseAdmin();
  const targetIds = changes.scope === "series" ? await seriesTargetIds(cls) : [cls.id];

  // Anti-solape ANTES de escribir: el índice único solo frena la misma
  // hora exacta, así que mover una clase 10 min después de otra pasaba
  // (caso Thomas 2026-10-07: 19:10/19:20 y 20:00/20:10). Solape real,
  // sin exigir pausa, para no bloquear clases seguidas legítimas.
  if (cls.teacher_id && (changes.scheduledAt || changes.durationMinutes)) {
    const deltaMs = changes.scheduledAt
      ? new Date(changes.scheduledAt).getTime() - new Date(cls.scheduled_at).getTime()
      : 0;
    const { data: targets } = await sb
      .from("classes").select("id, scheduled_at, duration_minutes").in("id", targetIds);
    for (const t of (targets ?? []) as Array<{ id: string; scheduled_at: string; duration_minutes: number }>) {
      const conflicts = await findTeacherConflicts(sb, {
        teacherId:       cls.teacher_id,
        startIso:        new Date(new Date(t.scheduled_at).getTime() + deltaMs).toISOString(),
        durationMinutes: changes.durationMinutes ?? t.duration_minutes,
        excludeIds:      targetIds,
        breakMinutes:    0,
      });
      if (conflicts.length > 0) {
        const other = new Date(conflicts[0].scheduled_at).toLocaleString("es-ES", {
          timeZone: "Europe/Berlin", weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
        });
        return NextResponse.json(
          { error: "double_booking", message: `Ese horario se pisa con otra clase tuya (${other}, hora de Berlín). Elige un horario libre.` },
          { status: 409 },
        );
      }
    }
  }

  // Campos planos → a todos los targets
  const patch: Record<string, unknown> = {};
  if (changes.durationMinutes) patch.duration_minutes = changes.durationMinutes;
  if (changes.title)           patch.title            = changes.title;
  if (changes.topic !== undefined) patch.topic        = changes.topic;
  if (Object.keys(patch).length > 0) {
    const { error } = await sb.from("classes").update(patch).in("id", targetIds);
    if (error) {
      return NextResponse.json({ error: "update_failed", message: error.message }, { status: 500 });
    }
  }

  // scheduled_at: directo para "this", delta para "series".
  // El índice classes_no_double_booking_uidx (profe + misma hora exacta,
  // clases scheduled/live) rechaza el UPDATE si el profe ya tiene otra
  // clase en ese slot — traducimos el error crudo de Postgres a un
  // mensaje claro (caso Thomas/Myriam 2026-09-30).
  const rescheduleError = (message: string) => {
    if (/classes_no_double_booking_uidx|duplicate key/i.test(message)) {
      return NextResponse.json(
        { error: "double_booking", message: "Ya tienes otra clase agendada exactamente a esa hora. Elige un horario libre (revisa tu calendario)." },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: "update_failed", message }, { status: 500 });
  };
  if (changes.scheduledAt) {
    const deltaMs = new Date(changes.scheduledAt).getTime() - new Date(cls.scheduled_at).getTime();
    if (changes.scope === "this" || deltaMs === 0) {
      const { error } = await sb.from("classes")
        .update({ scheduled_at: changes.scheduledAt })
        .eq("id", cls.id);
      if (error) return rescheduleError(error.message);
    } else {
      const { data: currents } = await sb
        .from("classes").select("id, scheduled_at").in("id", targetIds);
      for (const c of (currents ?? []) as Array<{ id: string; scheduled_at: string }>) {
        const shifted = new Date(new Date(c.scheduled_at).getTime() + deltaMs).toISOString();
        const { error } = await sb.from("classes")
          .update({ scheduled_at: shifted }).eq("id", c.id);
        if (error) return rescheduleError(error.message);
      }
    }
  }

  // Notify students when timing changed — UNA notificación (resumen).
  if (changes.scheduledAt || changes.durationMinutes) {
    const newAt = changes.scheduledAt ? new Date(changes.scheduledAt) : new Date(cls.scheduled_at);
    const title = changes.title ?? cls.title;
    await notifyStudents(cls.id, "rescheduled", title, newAt, cls.duration_minutes, targetIds.length);
    // Espejo en Google Calendar (profe + central si es trial) — tras
    // responder, best-effort.
    after(() => syncTeacherCalendarAfterReschedule(targetIds).catch(e =>
      console.error("[teacher/classes] gcal sync failed:", e)));
  }

  return NextResponse.json({ ok: true, scope: changes.scope, updated: targetIds.length });
}

export async function DELETE(
  req:   Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const a = await authorizeEditor(id);
  if (!a.ok) return NextResponse.json(a.body, { status: a.status });
  const cls = a.cls as ClsRow;

  if (cls.status === "completed" || cls.status === "cancelled") {
    return NextResponse.json(
      { error: "bad_status", message: `La clase ya está ${cls.status === "completed" ? "completada" : "cancelada"}.` },
      { status: 400 },
    );
  }

  const url = new URL(req.url);
  const scope = url.searchParams.get("scope") === "series" ? "series" : "this";

  const sb = supabaseAdmin();
  const targetIds = scope === "series" ? await seriesTargetIds(cls) : [cls.id];

  const { error } = await sb
    .from("classes")
    .update({ status: "cancelled" })
    .in("id", targetIds);
  if (error) {
    return NextResponse.json({ error: "cancel_failed", message: error.message }, { status: 500 });
  }

  await notifyStudents(cls.id, "cancelled", cls.title, new Date(cls.scheduled_at), cls.duration_minutes, targetIds.length);

  after(() => removeTeacherCalendarEvents(targetIds).catch(e =>
    console.error("[teacher/classes] gcal cleanup failed:", e)));

  return NextResponse.json({ ok: true, scope, cancelled: targetIds.length });
}

async function notifyStudents(
  classId:        string,
  kind:           "rescheduled" | "cancelled",
  title:          string,
  when:           Date,
  durationMinutes = 60,
  seriesCount     = 1,
): Promise<void> {
  try {
    const sb = supabaseAdmin();
    const { data: participants } = await sb
      .from("class_participants")
      .select("student_id, students!inner(user_id, users!inner(email, full_name, language_preference))")
      .eq("class_id", classId);

    type Part = {
      student_id: string;
      students: {
        user_id: string;
        users: { email: string; full_name: string | null; language_preference: "es"|"de" } |
               Array<{ email: string; full_name: string | null; language_preference: "es"|"de" }>;
      } | Array<{
        user_id: string;
        users: { email: string; full_name: string | null; language_preference: "es"|"de" } |
               Array<{ email: string; full_name: string | null; language_preference: "es"|"de" }>;
      }>;
    };

    const seriesSuffixEs = seriesCount > 1 ? ` (serie completa: ${seriesCount} clases)` : "";

    for (const p of (participants ?? []) as Part[]) {
      const s = Array.isArray(p.students) ? p.students[0] : p.students;
      if (!s) continue;
      const u = Array.isArray(s.users) ? s.users[0] : s.users;
      if (!u) continue;
      const lang = u.language_preference;

      const fmt = when.toLocaleString(lang === "de" ? "de-DE" : "es-ES", {
        weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
        timeZone: "Europe/Berlin",
      });

      if (lifecycleEmailsEnabled() && u.email) {
        const first = (u.full_name ?? "").trim().split(/\s+/)[0] || u.email;
        sendClassLifecycleEmail(u.email, {
          audience:      "student",
          kind,
          recipientName: first,
          classTitle:    title + seriesSuffixEs,
          startDate:     fmt + (lang === "de" ? " (Berlin)" : " (Berlín)"),
          durationMin:   durationMinutes,
          count:         seriesCount,
          classUrl:      `${PLATFORM_URL}/estudiante/clases/${classId}`,
          language:      lang,
        }).catch(e => console.error(`[teacher/classes/${classId}] student email failed:`, e));
      }
      await createNotification({
        user_id:  s.user_id,
        type:     kind === "rescheduled" ? "class_updated" : "class_cancelled",
        title:    kind === "rescheduled"
          ? (seriesCount > 1 ? `Serie reprogramada (${seriesCount} clases)` : "Clase reprogramada")
          : (seriesCount > 1 ? `Serie cancelada (${seriesCount} clases)` : "Clase cancelada"),
        body:     `${title} — ${fmt}`,
        link:     `/estudiante/clases/${classId}`,
        class_id: classId,
      });
    }
  } catch (e) {
    console.error("notifyStudents failed:", e);
  }
}
