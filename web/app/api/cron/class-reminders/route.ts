import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { createNotification, reminderAlreadySent } from "@/lib/notifications";
import { sendClassReminder30mEmail } from "@/lib/email/send";

/**
 * GET/POST /api/cron/class-reminders
 *
 * Called every 5-10 minutes by an external scheduler. Auth: either
 * `Authorization: Bearer <CRON_SECRET>` (Vercel Cron) or
 * `X-Cron-Secret: <CRON_SECRET>` (manual / external).
 *
 * Sends ONE pre-class reminder per scheduled class, by email, ~30 min
 * before start. The previous setup (WhatsApp at 24h/1h/15min, plus
 * in-app at the same windows) was consolidated to a single email per
 * Gelfis's request — too much noise was the original problem.
 *
 * Recipients per class: the teacher AND every student. Each gets the
 * same template with `partner` adapted to their role:
 *   - Student sees "Con Sabine" (teacher's full name)
 *   - Teacher sees "Con Maria, Juan" (comma-separated student names)
 *
 * Idempotency: a row in `notifications` with type='class_reminder_30m'
 * and (user_id, class_id) marks "already sent" — so the cron can run
 * every minute without producing duplicates.
 */

const REMINDER_TYPE = "class_reminder_30m";
const PLATFORM_URL  = process.env.PLATFORM_URL ?? "https://b2c.aprender-aleman.de";
// Window: 25-35 min before class start. Wider than the 5-10min cron
// interval so we never miss it; idempotency guard takes care of repeats.
const WINDOW_LOW_MS  = 25 * 60_000;
const WINDOW_HIGH_MS = 35 * 60_000;

function authorisedCronRequest(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const bearer = req.headers.get("authorization");
  if (bearer && bearer.toLowerCase().startsWith("bearer ")) {
    if (bearer.slice(7).trim() === expected) return true;
  }
  const xh = req.headers.get("x-cron-secret");
  return xh === expected;
}

export async function GET(req: Request) { return runCron(req); }
export async function POST(req: Request) { return runCron(req); }

async function runCron(req: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "cron_not_configured" }, { status: 503 });
  }
  if (!authorisedCronRequest(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const now = Date.now();
  const sb  = supabaseAdmin();

  // Pull every scheduled class starting in the upcoming window. We keep
  // a generous outer bound (40 min) so a clock-drift on either side
  // doesn't make us miss the class.
  const { data: classes } = await sb
    .from("classes")
    .select(`
      id, scheduled_at, duration_minutes, title, teacher_id,
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
    .eq("status", "scheduled")
    .gte("scheduled_at", new Date(now).toISOString())
    .lte("scheduled_at", new Date(now + 40 * 60_000).toISOString());

  if (!classes || classes.length === 0) {
    return NextResponse.json({ ok: true, classesChecked: 0, remindersSent: 0 });
  }

  type UserRow = { email: string; full_name: string | null; language_preference: "es" | "de"; notifications_opt_out?: boolean };
  type TeacherShape = {
    user_id: string;
    users: UserRow | UserRow[];
  };
  type ParticipantShape = {
    student_id: string;
    student: { user_id: string; users: UserRow | UserRow[] } |
             Array<{ user_id: string; users: UserRow | UserRow[] }>;
  };

  const flat = <T>(x: T | T[] | null | undefined): T | null =>
    !x ? null : Array.isArray(x) ? (x[0] ?? null) : x;

  let sent = 0;
  for (const c of classes) {
    const startMs = new Date(c.scheduled_at as string).getTime();
    const msUntil = startMs - now;
    if (msUntil < WINDOW_LOW_MS || msUntil > WINDOW_HIGH_MS) continue;

    const teacherWrap  = flat(c.teacher as unknown as TeacherShape | TeacherShape[]);
    const teacherUser  = teacherWrap ? flat(teacherWrap.users) : null;
    const teacherName  = teacherUser?.full_name?.trim() || teacherUser?.email || "tu profesor/a";
    const teacherFirst = (teacherName.split(/\s+/)[0]) || teacherName;

    // Students of this class — used both as recipients AND to build the
    // teacher's "partner" line ("Con Maria, Juan"). Opt-out users are
    // excluded from the recipient list but still shown in the partner
    // label (the teacher should still see who the class is with).
    const participants = (c.class_participants as ParticipantShape[]) ?? [];
    const studentEntries = participants.map(p => {
      const sw = flat(p.student);
      const su = sw ? flat(sw.users) : null;
      return sw && su ? {
        userId: sw.user_id,
        email:  su.email,
        name:   su.full_name?.trim() || su.email,
        first:  (su.full_name?.trim() || su.email).split(/\s+/)[0] || su.email,
        lang:   su.language_preference,
        optOut: Boolean(su.notifications_opt_out),
      } : null;
    }).filter((x): x is NonNullable<typeof x> => x !== null);
    const studentLabel = studentEntries.map(s => s.first).join(", ") || "tus estudiantes";

    // Berlin-formatted start time, used in every email body.
    const startTime = new Date(startMs).toLocaleString("es-ES", {
      timeZone: "Europe/Berlin",
      hour:     "2-digit",
      minute:   "2-digit",
    }) + " (Berlín)";

    const classUrl = `${PLATFORM_URL.replace(/\/$/, "")}/aula/${c.id}`;
    const classTitle = (c.title as string | null) ?? "Tu clase";

    // ── Teacher email (skipped entirely if teacher is opted out)
    const teacherOptOut = Boolean(teacherUser?.notifications_opt_out);
    if (teacherWrap && teacherUser?.email && !teacherOptOut) {
      const already = await reminderAlreadySent(teacherWrap.user_id, c.id as string, REMINDER_TYPE);
      if (!already) {
        // In-app notification doubles as the dedup record.
        await createNotification({
          user_id:  teacherWrap.user_id,
          type:     REMINDER_TYPE,
          title:    "Tu clase empieza en 30 minutos",
          body:     `${classTitle} · ${startTime}`,
          link:     `/aula/${c.id}`,
          class_id: c.id as string,
        });
        await sendClassReminder30mEmail(teacherUser.email, {
          name:       teacherFirst,
          classTitle,
          startTime,
          partner:    studentLabel,
          classUrl,
          language:   teacherUser.language_preference,
        }).catch(e => console.error("class-reminder email (teacher) failed:", e));
        sent++;
      }
    }

    // ── Student emails (opt-out users are silently skipped)
    for (const s of studentEntries) {
      if (s.optOut) continue;
      const already = await reminderAlreadySent(s.userId, c.id as string, REMINDER_TYPE);
      if (already) continue;

      await createNotification({
        user_id:  s.userId,
        type:     REMINDER_TYPE,
        title:    "Tu clase empieza en 30 minutos",
        body:     `${classTitle} · ${startTime}`,
        link:     `/aula/${c.id}`,
        class_id: c.id as string,
      });
      await sendClassReminder30mEmail(s.email, {
        name:       s.first,
        classTitle,
        startTime,
        partner:    teacherName,
        classUrl,
        language:   s.lang,
      }).catch(e => console.error("class-reminder email (student) failed:", e));
      sent++;
    }
  }

  return NextResponse.json({ ok: true, classesChecked: classes.length, remindersSent: sent });
}
