import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { sendClassLifecycleEmail } from "@/lib/email/send";

/**
 * POST /api/internal/cancel-class
 *
 * One-shot "cancel + notify" para clases regulares (no trials).
 * Llamado desde scripts/admin tools cuando se cancela una clase puntual
 * y queremos:
 *   1. Marcar status='cancelled' en DB (cron de recordatorios la
 *      ignorará automáticamente)
 *   2. Borrar el evento de Google Calendar si existe
 *   3. Enviar email de cancelación a profe + cada alumno (respetando
 *      notifications_opt_out)
 *
 * Auth: header x-internal-api-key.
 *
 * Body:
 *   {
 *     class_id: "uuid",
 *     reason?: "string opcional con motivo (se incluye en el email si está)"
 *   }
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const expected = process.env.B2C_INTERNAL_API_KEY;
  if (!expected) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  if (req.headers.get("x-internal-api-key") !== expected) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: { class_id?: string; reason?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  if (!body.class_id) return NextResponse.json({ error: "class_id_required" }, { status: 400 });

  const sb = supabaseAdmin();

  // Pull class + teacher + participants antes de actualizar (necesitamos
  // los datos para los emails).
  const { data: cls } = await sb
    .from("classes")
    .select(`
      id, scheduled_at, duration_minutes, title, status,
      google_calendar_event_id,
      teacher:teachers!inner(
        user_id,
        users!inner(email, full_name, language_preference, notifications_opt_out)
      ),
      class_participants(
        student_id,
        student:students!inner(
          user_id,
          users!inner(email, full_name, language_preference, notifications_opt_out)
        )
      )
    `)
    .eq("id", body.class_id)
    .maybeSingle();

  if (!cls) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if ((cls as { status: string }).status !== "scheduled") {
    return NextResponse.json({
      ok: false, error: "not_scheduled",
      reason: `clase ya tiene status='${(cls as { status: string }).status}'`,
    }, { status: 409 });
  }

  // 1. Update DB
  const { error: updErr } = await sb
    .from("classes")
    .update({ status: "cancelled" })
    .eq("id", body.class_id)
    .eq("status", "scheduled");
  if (updErr) {
    return NextResponse.json({ error: "update_failed", message: updErr.message }, { status: 500 });
  }

  // 2. GCal cleanup (best-effort, async)
  const gcalId = (cls as { google_calendar_event_id: string | null }).google_calendar_event_id;
  let gcalDeleted = false;
  if (gcalId) {
    try {
      const { deleteTrialEvent } = await import("@/lib/google-calendar");
      gcalDeleted = await deleteTrialEvent(gcalId);
    } catch (e) {
      console.warn("[cancel-class] gcal cleanup failed:", e);
    }
  }

  // 3. Emails
  type UserRow = { email: string; full_name: string | null; language_preference: "es" | "de"; notifications_opt_out: boolean | null };
  const flat = <T,>(x: T | T[] | null | undefined): T | null => !x ? null : Array.isArray(x) ? x[0] ?? null : x;

  const teacherWrap = flat((cls as { teacher: unknown }).teacher as { user_id: string; users: UserRow | UserRow[] } | Array<{ user_id: string; users: UserRow | UserRow[] }>);
  const tu = teacherWrap ? flat(teacherWrap.users) : null;

  const startDate = new Date((cls as { scheduled_at: string }).scheduled_at).toLocaleString("es-ES", {
    timeZone: "Europe/Berlin",
    weekday: "long", day: "numeric", month: "long",
    hour: "2-digit", minute: "2-digit",
  }) + " (Berlín)";
  const startDateDe = new Date((cls as { scheduled_at: string }).scheduled_at).toLocaleString("de-DE", {
    timeZone: "Europe/Berlin",
    weekday: "long", day: "numeric", month: "long",
    hour: "2-digit", minute: "2-digit",
  }) + " (Berlin)";

  const PLATFORM_URL = (process.env.PLATFORM_URL ?? "https://b2c.aprender-aleman.de").replace(/\/$/, "");
  const classUrl = `${PLATFORM_URL}/aula/${body.class_id}`;
  const classTitle = (cls as { title: string }).title;
  const durationMin = (cls as { duration_minutes: number }).duration_minutes;

  let sentTeacher = false, sentStudents = 0, skippedOptOut = 0, failed = 0;

  // Profesor
  if (tu?.email && !tu.notifications_opt_out) {
    const r = await sendClassLifecycleEmail(tu.email, {
      audience:      "teacher",
      kind:          "cancelled",
      recipientName: (tu.full_name?.trim() || tu.email).split(/\s+/)[0],
      classTitle,
      startDate:     tu.language_preference === "de" ? startDateDe : startDate,
      durationMin,
      classUrl,
      language:      tu.language_preference,
    });
    if (r.ok) sentTeacher = true; else failed++;
  } else if (tu?.notifications_opt_out) {
    skippedOptOut++;
  }

  // Estudiantes
  type Part = { student_id: string; student: { user_id: string; users: UserRow | UserRow[] } | Array<{ user_id: string; users: UserRow | UserRow[] }> };
  const parts = ((cls as { class_participants: Part[] | null }).class_participants ?? []);
  for (const p of parts) {
    const sw = flat(p.student);
    const su = sw ? flat(sw.users) : null;
    if (!su?.email) continue;
    if (su.notifications_opt_out) { skippedOptOut++; continue; }
    const r = await sendClassLifecycleEmail(su.email, {
      audience:      "student",
      kind:          "cancelled",
      recipientName: (su.full_name?.trim() || su.email).split(/\s+/)[0],
      classTitle,
      startDate:     su.language_preference === "de" ? startDateDe : startDate,
      durationMin,
      classUrl,
      language:      su.language_preference,
    });
    if (r.ok) sentStudents++; else failed++;
  }

  return NextResponse.json({
    ok: true,
    class_id: body.class_id,
    cancelled: true,
    gcal_deleted: gcalDeleted,
    emails: { teacher: sentTeacher, students: sentStudents, skipped_opt_out: skippedOptOut, failed },
  });
}
