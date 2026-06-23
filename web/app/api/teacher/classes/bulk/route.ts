import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getTeacherByUserId } from "@/lib/academy";
import { resolveEffectiveUser } from "@/lib/impersonation";
import { createClass } from "@/lib/classes";
import { supabaseAdmin } from "@/lib/supabase";
import { wireChatsForClass } from "@/lib/chat";
import { createNotification } from "@/lib/notifications";
import { sendClassScheduleSummaryEmail, lifecycleEmailsEnabled } from "@/lib/email/send";

const PLATFORM_URL = (process.env.PLATFORM_URL ?? "https://b2c.aprender-aleman.de").replace(/\/$/, "");

/**
 * POST /api/teacher/classes/bulk  (Gelfis 2026-06-23)
 *
 * Versión flexible del scheduler: el profesor agenda VARIOS slots de
 * golpe para un estudiante regular (post-conversión). Cada slot puede
 * tener su propia fecha, duración y recurrencia.
 *
 * Body:
 *   {
 *     type: "individual" | "group",
 *     studentIds: string[],
 *     title: string,
 *     slots: [
 *       { scheduledAt, durationMinutes, recurrencePattern, recurrenceEndDate? },
 *       ...
 *     ]
 *   }
 *
 * Tras crear todos los slots, envía UN email al estudiante con el
 * resumen completo + cuál es su primera clase + instrucciones para
 * unirse. Y notificaciones in-app por slot.
 */
export const runtime = "nodejs";
export const maxDuration = 60;

const SlotSchema = z.object({
  scheduledAt:       z.string().datetime(),
  durationMinutes:   z.coerce.number().int().min(15).max(240),
  recurrencePattern: z.enum(["none", "weekly", "biweekly", "monthly"]).default("none"),
  recurrenceEndDate: z.string().date().nullable().default(null),
});

const Body = z.object({
  type:       z.enum(["individual", "group"]),
  studentIds: z.array(z.string().uuid()).min(1).max(20),
  title:      z.string().trim().min(2).max(200),
  topic:      z.string().trim().max(500).nullable().default(null),
  slots:      z.array(SlotSchema).min(1).max(7),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const role = (session.user as { role?: string }).role;
  if (role !== "teacher" && role !== "admin" && role !== "superadmin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const eff = await resolveEffectiveUser({
    fallbackUserId: (session.user as { id: string }).id,
    fallbackRole:   role as "teacher" | "admin" | "superadmin",
    expectRole:     "teacher",
  });
  const me = await getTeacherByUserId(eff.userId);
  if (!me) {
    return NextResponse.json({ error: "no_teacher_profile" }, { status: 403 });
  }

  let rawBody: unknown;
  try { rawBody = await req.json(); }
  catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }

  const parsed = Body.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_failed", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const body = parsed.data;

  if (body.type === "individual" && body.studentIds.length !== 1) {
    return NextResponse.json(
      { error: "validation_failed", message: "Una clase individual requiere exactamente 1 estudiante." },
      { status: 400 },
    );
  }

  // Validación por slot: si tiene recurrencia, necesita fecha fin.
  for (const s of body.slots) {
    if (s.recurrencePattern !== "none" && !s.recurrenceEndDate) {
      return NextResponse.json(
        { error: "validation_failed", message: "Cada horario con recurrencia necesita una fecha fin." },
        { status: 400 },
      );
    }
  }

  // Ownership check (igual que /api/teacher/classes single).
  const sb = supabaseAdmin();
  const [mineRows, groupRows] = await Promise.all([
    sb.from("classes")
      .select("class_participants!inner(student_id)")
      .eq("teacher_id", me.id),
    sb.from("student_group_members")
      .select("student_id, group:student_groups!inner(teacher_id)")
      .eq("group.teacher_id", me.id),
  ]);
  const myStudentIds = new Set<string>();
  for (const r of (mineRows.data ?? []) as Array<{ class_participants: Array<{ student_id: string }> }>) {
    for (const cp of r.class_participants) myStudentIds.add(cp.student_id);
  }
  for (const r of (groupRows.data ?? []) as Array<{ student_id: string }>) {
    myStudentIds.add(r.student_id);
  }
  const outsiders = body.studentIds.filter(id => !myStudentIds.has(id));
  if (outsiders.length > 0) {
    return NextResponse.json(
      { error: "student_not_yours",
        message: "Solo puedes agendar clases con estudiantes que ya son tuyos." },
      { status: 403 },
    );
  }

  // ── Creación: itera slots ──────────────────────────────────────
  type SlotResult = {
    parentId: string;
    instances: number;
    scheduledAt: string;
    durationMinutes: number;
    recurrencePattern: string;
    recurrenceEndDate: string | null;
  };
  const results: SlotResult[] = [];
  for (const s of body.slots) {
    try {
      const r = await createClass({
        type:              body.type,
        teacherId:         me.id,
        studentIds:        body.studentIds,
        scheduledAt:       new Date(s.scheduledAt),
        durationMinutes:   s.durationMinutes,
        recurrencePattern: s.recurrencePattern,
        recurrenceEndDate: s.recurrenceEndDate ? new Date(s.recurrenceEndDate + "T23:59:59Z") : null,
        title:             body.title,
        topic:             body.topic,
        notesAdmin:        null,
        createdByUserId:   (session.user as { id?: string }).id ?? null,
      });
      results.push({
        parentId: r.parentId, instances: r.ids.length,
        scheduledAt: s.scheduledAt, durationMinutes: s.durationMinutes,
        recurrencePattern: s.recurrencePattern, recurrenceEndDate: s.recurrenceEndDate,
      });
    } catch (e) {
      return NextResponse.json(
        { error: "create_failed", failed_slot: s, message: e instanceof Error ? e.message : "unknown",
          created_so_far: results.length },
        { status: 500 },
      );
    }
  }

  // ── Wire chats por slot ────────────────────────────────────────
  for (const r of results) {
    wireChatsForClass({
      classId:    r.parentId,
      type:       body.type,
      teacherId:  me.id,
      studentIds: body.studentIds,
      classTitle: body.title,
    }).catch(e => console.error("wireChatsForClass failed:", e));
  }

  // ── Email + notif: UN email consolidado al estudiante ──────────
  const totalClasses = results.reduce((acc, r) => acc + r.instances, 0);
  // Primera clase = fecha más temprana de TODOS los slots.
  const firstClassIso = results
    .map(r => r.scheduledAt)
    .sort()[0]!;

  await notifyStudentsBulk({
    studentIds:    body.studentIds,
    classTitle:    body.title,
    slots:         results,
    totalClasses,
    firstClassIso,
    firstClassId:  results[0]!.parentId,
  });

  return NextResponse.json({
    ok: true,
    slots_created: results.length,
    total_classes: totalClasses,
    first_class_at: firstClassIso,
    results,
  });
}

async function notifyStudentsBulk(opts: {
  studentIds: string[];
  classTitle: string;
  slots: Array<{ scheduledAt: string; durationMinutes: number; recurrencePattern: string; recurrenceEndDate: string | null; instances: number }>;
  totalClasses: number;
  firstClassIso: string;
  firstClassId: string;
}): Promise<void> {
  const sb = supabaseAdmin();
  const { data: studentRows } = await sb
    .from("students")
    .select("id, user_id, users!inner(email, full_name, language_preference)")
    .in("id", opts.studentIds);

  for (const s of studentRows ?? []) {
    const u = (s as { users: unknown }).users;
    const uu = (Array.isArray(u) ? u[0] : u) as
      | { email: string; full_name: string | null; language_preference: "es" | "de" }
      | undefined;
    const userId = (s as { user_id: string }).user_id;
    const lang = uu?.language_preference ?? "es";

    const fmtFirst = new Date(opts.firstClassIso).toLocaleString(
      lang === "de" ? "de-DE" : "es-ES",
      { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" },
    ) + (lang === "de" ? " (Berlin)" : " (Berlín)");

    const slotsHuman = opts.slots.map(s => formatSlotHuman(s, lang));

    if (lifecycleEmailsEnabled() && uu?.email) {
      const first = (uu.full_name ?? "").trim().split(/\s+/)[0] || uu.email;
      sendClassScheduleSummaryEmail(uu.email, {
        recipientName: first,
        classTitle:    opts.classTitle,
        totalClasses:  opts.totalClasses,
        firstClassAt:  fmtFirst,
        slotsHuman,
        classUrl:      `${PLATFORM_URL}/estudiante/clases/${opts.firstClassId}`,
        language:      lang,
      }).catch(e => console.error("[teacher/classes/bulk] email failed:", e));
    }
    if (userId) {
      await createNotification({
        user_id:  userId,
        type:     "class_scheduled",
        title:    lang === "de" ? "Neue Stundenreihe agendiert" : "Nuevas clases agendadas",
        body:     `${opts.classTitle} — ${opts.totalClasses} ${lang === "de" ? "Stunden" : "clases"} · ${lang === "de" ? "1." : "1ª"} ${fmtFirst}`,
        link:     `/estudiante/clases/${opts.firstClassId}`,
        class_id: opts.firstClassId,
      });
    }
  }
}

function formatSlotHuman(
  s: { scheduledAt: string; durationMinutes: number; recurrencePattern: string; recurrenceEndDate: string | null; instances: number },
  lang: "es" | "de",
): string {
  const at = new Date(s.scheduledAt);
  const weekday = at.toLocaleString(lang === "de" ? "de-DE" : "es-ES",
    { weekday: "long", timeZone: "Europe/Berlin" });
  const time = at.toLocaleString(lang === "de" ? "de-DE" : "es-ES",
    { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });
  const cap = (s2: string) => s2.charAt(0).toUpperCase() + s2.slice(1);
  if (s.recurrencePattern === "none") {
    const fullDate = at.toLocaleString(lang === "de" ? "de-DE" : "es-ES",
      { day: "numeric", month: "long", timeZone: "Europe/Berlin" });
    return lang === "de"
      ? `Einmalig: ${cap(weekday)} ${fullDate} um ${time}`
      : `Única: ${cap(weekday)} ${fullDate} a las ${time}`;
  }
  const recurLabel = s.recurrencePattern === "weekly"
    ? (lang === "de" ? "wöchentlich" : "semanal")
    : s.recurrencePattern === "biweekly"
      ? (lang === "de" ? "alle 2 Wochen" : "quincenal")
      : (lang === "de" ? "monatlich" : "mensual");
  const endStr = s.recurrenceEndDate
    ? new Date(s.recurrenceEndDate + "T00:00:00Z").toLocaleDateString(
        lang === "de" ? "de-DE" : "es-ES",
        { day: "numeric", month: "long", year: "numeric" })
    : null;
  const tail = endStr
    ? (lang === "de" ? ` bis ${endStr}` : ` hasta ${endStr}`)
    : "";
  return lang === "de"
    ? `${cap(weekday)} um ${time} (${recurLabel}${tail})`
    : `${cap(weekday)} a las ${time} (${recurLabel}${tail})`;
}
