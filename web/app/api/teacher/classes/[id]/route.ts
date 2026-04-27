import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getTeacherByUserId } from "@/lib/academy";
import { supabaseAdmin } from "@/lib/supabase";
import { createNotification } from "@/lib/notifications";
import { sendClassLifecycleEmail } from "@/lib/email/send";

const PLATFORM_URL = (process.env.PLATFORM_URL ?? "https://b2c.aprender-aleman.de").replace(/\/$/, "");

/**
 * PATCH /api/teacher/classes/{id}  — reschedule / edit a single class instance
 * DELETE /api/teacher/classes/{id} — cancel (soft: status='cancelled')
 *
 * Ownership: caller must be the class's assigned teacher. Admins also
 * allowed. Only works on classes with status='scheduled' — once the
 * class is live/completed the teacher should use the end-class flow.
 * Notifies participating students via WhatsApp + in-app on both paths.
 *
 * This endpoint edits ONE instance. Recurring series edits stay in
 * admin's hands for now (too many footguns: "bump all future Mondays?").
 */

export const runtime = "nodejs";

const PatchBody = z.object({
  scheduledAt:     z.string().datetime().optional(),
  durationMinutes: z.coerce.number().int().min(15).max(240).optional(),
  title:           z.string().trim().min(2).max(200).optional(),
  topic:           z.string().trim().max(500).nullable().optional(),
}).refine(b => Object.keys(b).length > 0, { message: "no_changes" });

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
    .select("id, teacher_id, status, scheduled_at, duration_minutes, title, type")
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

export async function PATCH(
  req:    Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const a = await authorizeEditor(id);
  if (!a.ok) return NextResponse.json(a.body, { status: a.status });
  const cls = a.cls as { id: string; teacher_id: string | null; status: string; scheduled_at: string; duration_minutes: number; title: string; type: string };
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
  const patch: Record<string, unknown> = {};
  if (changes.scheduledAt)     patch.scheduled_at     = changes.scheduledAt;
  if (changes.durationMinutes) patch.duration_minutes = changes.durationMinutes;
  if (changes.title)           patch.title            = changes.title;
  if (changes.topic !== undefined) patch.topic        = changes.topic;

  const { error } = await sb.from("classes").update(patch).eq("id", cls.id);
  if (error) {
    return NextResponse.json({ error: "update_failed", message: error.message }, { status: 500 });
  }

  // Notify students when timing changed.
  if (changes.scheduledAt || changes.durationMinutes) {
    const newAt = changes.scheduledAt ? new Date(changes.scheduledAt) : new Date(cls.scheduled_at);
    const title = changes.title ?? cls.title;
    await notifyStudents(cls.id, "rescheduled", title, newAt);
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req:   Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const a = await authorizeEditor(id);
  if (!a.ok) return NextResponse.json(a.body, { status: a.status });
  const cls = a.cls as { id: string; status: string; scheduled_at: string; title: string };

  if (cls.status === "completed" || cls.status === "cancelled") {
    return NextResponse.json(
      { error: "bad_status", message: `La clase ya está ${cls.status === "completed" ? "completada" : "cancelada"}.` },
      { status: 400 },
    );
  }

  const sb = supabaseAdmin();
  const { error } = await sb
    .from("classes")
    .update({ status: "cancelled" })
    .eq("id", cls.id);
  if (error) {
    return NextResponse.json({ error: "cancel_failed", message: error.message }, { status: 500 });
  }

  await notifyStudents(cls.id, "cancelled", cls.title, new Date(cls.scheduled_at));

  return NextResponse.json({ ok: true });
}

async function notifyStudents(
  classId:        string,
  kind:           "rescheduled" | "cancelled",
  title:          string,
  when:           Date,
  durationMinutes = 60,
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

      if (u.email) {
        const first = (u.full_name ?? "").trim().split(/\s+/)[0] || u.email;
        sendClassLifecycleEmail(u.email, {
          audience:      "student",
          kind,
          recipientName: first,
          classTitle:    title,
          startDate:     fmt + (lang === "de" ? " (Berlin)" : " (Berlín)"),
          durationMin:   durationMinutes,
          count:         1,
          classUrl:      `${PLATFORM_URL}/estudiante/clases/${classId}`,
          language:      lang,
        }).catch(e => console.error(`[teacher/classes/${classId}] student email failed:`, e));
      }
      await createNotification({
        user_id:  s.user_id,
        type:     kind === "rescheduled" ? "class_updated" : "class_cancelled",
        title:    kind === "rescheduled" ? "Clase reprogramada" : "Clase cancelada",
        body:     `${title} — ${fmt}`,
        link:     `/estudiante/clases/${classId}`,
        class_id: classId,
      });
    }
  } catch (e) {
    console.error("notifyStudents failed:", e);
  }
}
