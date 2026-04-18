import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { sendWhatsappText } from "@/lib/whatsapp";
import { createNotification, reminderAlreadySent } from "@/lib/notifications";

/**
 * POST /api/cron/class-reminders
 *
 * Called every 5-10 minutes by an external scheduler (agents VPS
 * APScheduler, Vercel Cron, or a GitHub Action). Auth: X-Cron-Secret
 * must match CRON_SECRET env.
 *
 * For every class in 'scheduled' status starting in the next ~25 hours,
 * fires the appropriate reminders if they haven't been fired yet:
 *   - class_reminder_24h  (24h window: 23:00–24:00 before start)
 *   - class_reminder_1h   (1h window:  55–65 min before start)
 *   - class_reminder_15m  (15min window: 10–20 min before start)
 *
 * Each reminder = in-app notification + WhatsApp (best-effort). De-duped
 * by a unique check on (user_id, class_id, type) in the notifications
 * table — we never send the same reminder twice.
 */

type Window = {
  type:      "class_reminder_24h" | "class_reminder_1h" | "class_reminder_15m";
  lowMs:     number;    // inclusive
  highMs:    number;    // inclusive
  labelEs:   string;    // short, used in subject line
  labelDe:   string;
};

const WINDOWS: Window[] = [
  { type: "class_reminder_24h", lowMs: 23 * 3600_000,   highMs: 25 * 3600_000,   labelEs: "24 horas",    labelDe: "24 Stunden" },
  { type: "class_reminder_1h",  lowMs: 55 * 60_000,     highMs: 65 * 60_000,     labelEs: "1 hora",      labelDe: "1 Stunde"   },
  { type: "class_reminder_15m", lowMs: 10 * 60_000,     highMs: 20 * 60_000,     labelEs: "15 minutos",  labelDe: "15 Minuten" },
];

/**
 * Auth accepts either form:
 *   - Authorization: Bearer <CRON_SECRET>   ← Vercel Cron sends this shape
 *   - X-Cron-Secret: <CRON_SECRET>          ← manual / external scheduler
 */
function authorisedCronRequest(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;

  const bearer = req.headers.get("authorization");
  if (bearer && bearer.toLowerCase().startsWith("bearer ")) {
    const token = bearer.slice(7).trim();
    if (token === expected) return true;
  }
  const xh = req.headers.get("x-cron-secret");
  if (xh && xh === expected) return true;
  return false;
}

// Vercel Cron sends GET by default. We also accept POST for manual
// invocations (curl -X POST -H "X-Cron-Secret: ...").
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
  const horizonMs = 26 * 3600_000;   // scan the next ~26 hours
  const sb = supabaseAdmin();

  const { data: classes } = await sb
    .from("classes")
    .select(`
      id, scheduled_at, duration_minutes, title, teacher_id,
      teacher:teachers!inner(
        user_id,
        users!inner(phone, language_preference)
      ),
      class_participants(
        student_id,
        student:students!inner(
          user_id,
          users!inner(phone, language_preference)
        )
      )
    `)
    .eq("status", "scheduled")
    .gte("scheduled_at", new Date(now).toISOString())
    .lte("scheduled_at", new Date(now + horizonMs).toISOString());

  if (!classes || classes.length === 0) {
    return NextResponse.json({ ok: true, classesChecked: 0, remindersSent: 0 });
  }

  let sent = 0;
  for (const c of classes) {
    const startMs = new Date(c.scheduled_at as string).getTime();
    const msUntil = startMs - now;

    const matched = WINDOWS.find(w => msUntil >= w.lowMs && msUntil <= w.highMs);
    if (!matched) continue;

    // Build recipients: teacher + every student.
    const t = c.teacher as unknown;
    const tFlat = (Array.isArray(t) ? t[0] : t) as {
      user_id: string;
      users: { phone: string | null; language_preference: "es" | "de" }
             | Array<{ phone: string | null; language_preference: "es" | "de" }>;
    } | null;
    const tu = tFlat ? (Array.isArray(tFlat.users) ? tFlat.users[0] : tFlat.users) : null;

    const recipients: Array<{
      userId:    string;
      phone:     string | null;
      lang:      "es" | "de";
      role:      "teacher" | "student";
    }> = [];
    if (tFlat && tu) {
      recipients.push({
        userId:    tFlat.user_id,
        phone:     tu.phone,
        lang:      tu.language_preference,
        role:      "teacher",
      });
    }
    const participants = (c.class_participants as Array<{
      student: unknown;
    }>) ?? [];
    for (const p of participants) {
      const s = p.student;
      const sFlat = (Array.isArray(s) ? s[0] : s) as {
        user_id: string;
        users: { phone: string | null; language_preference: "es" | "de" }
               | Array<{ phone: string | null; language_preference: "es" | "de" }>;
      } | null;
      if (!sFlat) continue;
      const su = Array.isArray(sFlat.users) ? sFlat.users[0] : sFlat.users;
      recipients.push({
        userId: sFlat.user_id,
        phone:  su.phone,
        lang:   su.language_preference,
        role:   "student",
      });
    }

    for (const r of recipients) {
      const already = await reminderAlreadySent(r.userId, c.id as string, matched.type);
      if (already) continue;

      const subject = r.lang === "de"
        ? `In ${matched.labelDe}: ${c.title}`
        : `En ${matched.labelEs}: ${c.title}`;
      const body = r.lang === "de"
        ? `${c.title} beginnt in ${matched.labelDe}. Tippe hier, um einzutreten, wenn das Aula offen ist.`
        : `${c.title} empieza en ${matched.labelEs}. Pulsa aquí para entrar al aula cuando esté abierta.`;

      await createNotification({
        user_id:  r.userId,
        type:     matched.type,
        title:    subject,
        body,
        link:     r.role === "teacher" ? `/profesor/clases/${c.id}` : `/estudiante/clases/${c.id}`,
        class_id: c.id as string,
      });

      if (r.phone) {
        const wa = r.lang === "de"
          ? `🔔 ${c.title}\n\nStart in ${matched.labelDe}.`
          : `🔔 ${c.title}\n\nEmpieza en ${matched.labelEs}.`;
        await sendWhatsappText(r.phone, wa).catch(() => { /* swallow */ });
      }
      sent++;
    }
  }

  return NextResponse.json({ ok: true, classesChecked: classes.length, remindersSent: sent });
}
