import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { sendTrialReminderEmail } from "@/lib/email/send";

/**
 * GET/POST /api/cron/trial-reminders-24h
 *
 * Vercel Cron hits this hourly. For every trial class scheduled
 * roughly 24h from now (window: 23-25h), fires an EMAIL reminder
 * to BOTH the lead and the teacher. WhatsApp is reserved for the
 * 30-min-before nudge (handled by the Python scheduler).
 *
 * Auth: Authorization: Bearer <CRON_SECRET> or X-Cron-Secret.
 *
 * Idempotency: marker on classes.notes_admin so the cron can run
 * hourly without duplicating sends.
 */
export const runtime  = "nodejs";
export const dynamic  = "force-dynamic";

const REMINDER_TAG = "[trial_reminder_24h_email_sent]";
const PLATFORM_URL = (process.env.PLATFORM_URL ?? "https://b2c.aprender-aleman.de").replace(/\/$/, "");

function authorisedCronRequest(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const bearer = req.headers.get("authorization");
  if (bearer && bearer.toLowerCase().startsWith("bearer ") && bearer.slice(7).trim() === expected) return true;
  return req.headers.get("x-cron-secret") === expected;
}

export async function GET(req: Request)  { return run(req); }
export async function POST(req: Request) { return run(req); }

async function run(req: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "cron_not_configured" }, { status: 503 });
  }
  if (!authorisedCronRequest(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const now = Date.now();
  const lo  = new Date(now + 23 * 3600_000).toISOString();
  const hi  = new Date(now + 25 * 3600_000).toISOString();

  const sb = supabaseAdmin();
  const { data: classes } = await sb
    .from("classes")
    .select(`
      id, scheduled_at, duration_minutes, notes_admin,
      teacher:teachers!inner(users!inner(full_name, email)),
      lead:leads!inner(id, name, language, email)
    `)
    .eq("is_trial", true)
    .eq("status", "scheduled")
    .gte("scheduled_at", lo)
    .lte("scheduled_at", hi);

  type Row = {
    id: string; scheduled_at: string; duration_minutes: number; notes_admin: string | null;
    teacher: { users: { full_name: string | null; email: string } | Array<{ full_name: string | null; email: string }> } |
             Array<{ users: { full_name: string | null; email: string } | Array<{ full_name: string | null; email: string }> }>;
    lead: { id: string; name: string; language: "es" | "de"; email: string | null } |
          Array<{ id: string; name: string; language: "es" | "de"; email: string | null }>;
  };
  const flat = <T,>(x: T | T[] | null | undefined): T | null => !x ? null : Array.isArray(x) ? x[0] ?? null : x;

  let sentLead = 0, sentTeacher = 0, skipped = 0;
  for (const r of (classes ?? []) as Row[]) {
    if ((r.notes_admin ?? "").includes(REMINDER_TAG)) { skipped++; continue; }

    const lead = flat(r.lead);
    const teacherWrap = flat(r.teacher);
    const tu = teacherWrap ? flat(teacherWrap.users) : null;

    if (!lead) { skipped++; continue; }

    const leadFirst    = (lead.name || "").split(/\s+/)[0] || lead.name || "";
    const teacherName  = tu?.full_name ?? tu?.email ?? "tu profesor/a";
    const teacherFirst = teacherName.split(/\s+/)[0] || teacherName;

    const startDate = new Date(r.scheduled_at).toLocaleString(
      lead.language === "de" ? "de-DE" : "es-ES",
      {
        timeZone: "Europe/Berlin",
        weekday: "long", day: "numeric", month: "long",
        hour: "2-digit", minute: "2-digit",
      },
    ) + (lead.language === "de" ? " (Berlin)" : " (Berlín)");

    const leadJoinUrl    = `${PLATFORM_URL}/aula/${r.id}`;
    const teacherJoinUrl = `${PLATFORM_URL}/aula/${r.id}`;

    // ── Lead email
    if (lead.email) {
      const res = await sendTrialReminderEmail(lead.email, {
        audience:        "lead",
        tone:            "24h_before",
        recipientName:   leadFirst,
        counterpartName: teacherName,
        startDate,
        durationMin:     r.duration_minutes ?? 45,
        joinUrl:         leadJoinUrl,
        language:        lead.language,
      });
      if (res.ok) sentLead++;
      else console.error(`[trial-reminders-24h] lead email failed for ${r.id}: ${res.error}`);
    }

    // ── Teacher email (only if we have one)
    if (tu?.email) {
      const res = await sendTrialReminderEmail(tu.email, {
        audience:        "teacher",
        tone:            "24h_before",
        recipientName:   teacherFirst,
        counterpartName: lead.name || leadFirst,
        startDate,
        durationMin:     r.duration_minutes ?? 45,
        joinUrl:         teacherJoinUrl,
        language:        "es",   // teachers see Spanish copy
      });
      if (res.ok) sentTeacher++;
      else console.error(`[trial-reminders-24h] teacher email failed for ${r.id}: ${res.error}`);
    }

    await sb.from("classes")
      .update({ notes_admin: `${r.notes_admin ?? ""}\n${REMINDER_TAG}`.trim() })
      .eq("id", r.id);
  }

  return NextResponse.json({
    ok: true,
    candidates: classes?.length ?? 0,
    sent_lead: sentLead,
    sent_teacher: sentTeacher,
    skipped,
  });
}
