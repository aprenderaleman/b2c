import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { computeRiskAlerts } from "@/lib/reports";
import { getTotalRevenue, getAllEarningsForMonth } from "@/lib/finance";
import { sendDailyDigestEmail } from "@/lib/email/send";

/**
 * GET or POST /api/cron/daily-digest
 *
 * Vercel Cron (or manual via X-Cron-Secret) triggers this once a day. We
 * aggregate: new leads/students in last 24h, classes today/week, revenue
 * today/month, unpaid payroll, and the top risk alerts — then email
 * Gelfis.
 *
 * Recipient:
 *   DIGEST_RECIPIENT   (email address) — required.
 */

function authorised(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;

  const bearer = req.headers.get("authorization");
  if (bearer && bearer.toLowerCase().startsWith("bearer ")) {
    if (bearer.slice(7).trim() === expected) return true;
  }
  const xh = req.headers.get("x-cron-secret");
  if (xh && xh === expected) return true;
  return false;
}

async function runDigest(req: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "cron_not_configured" }, { status: 503 });
  }
  if (!authorised(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const recipient = process.env.DIGEST_RECIPIENT ?? process.env.ADMIN_EMAIL;
  if (!recipient) {
    return NextResponse.json({ error: "no_recipient_configured" }, { status: 503 });
  }

  const sb = supabaseAdmin();
  const now = new Date();

  const since24h  = new Date(now.getTime() - 24 * 3600 * 1000);
  const dayStart  = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dayEnd    = new Date(dayStart.getTime() + 24 * 3600 * 1000);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const monthEnd   = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const weekEnd    = new Date(now.getTime() + 7 * 24 * 3600 * 1000);

  const [
    { count: newLeads24h = 0 },
    { count: newStudents24h = 0 },
    { count: classesToday = 0 },
    { count: classesThisWeek = 0 },
    revToday,
    revMonth,
    earnings,
    alerts,
  ] = await Promise.all([
    sb.from("leads").select("id", { count: "exact", head: true }).gte("created_at", since24h.toISOString()),
    sb.from("students").select("id", { count: "exact", head: true }).gte("converted_at", since24h.toISOString()),
    sb.from("classes").select("id", { count: "exact", head: true })
      .gte("scheduled_at", dayStart.toISOString()).lt("scheduled_at", dayEnd.toISOString()),
    sb.from("classes").select("id", { count: "exact", head: true })
      .gte("scheduled_at", now.toISOString()).lt("scheduled_at", weekEnd.toISOString()),
    getTotalRevenue(dayStart, dayEnd),
    getTotalRevenue(monthStart, monthEnd),
    getAllEarningsForMonth(now),
    computeRiskAlerts().catch(() => []),
  ]);

  const unpaidPayrollCents = earnings
    .filter(e => !e.paid)
    .reduce((s, e) => s + e.amount_cents, 0);

  const platformUrl = process.env.PLATFORM_URL ?? "https://live.aprender-aleman.de";

  const result = await sendDailyDigestEmail(recipient, {
    date:                  now.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long", year: "numeric" }),
    newLeads24h:           newLeads24h ?? 0,
    newStudents24h:        newStudents24h ?? 0,
    classesToday:          classesToday ?? 0,
    classesThisWeek:       classesThisWeek ?? 0,
    revenueTodayCents:     revToday.revenue_cents,
    revenueThisMonthCents: revMonth.revenue_cents,
    currency:              revMonth.currency,
    unpaidPayrollCents,
    riskAlerts:            alerts.map(a => ({ subject: a.subject, detail: a.detail })),
    adminUrl:              `${platformUrl.replace(/\/$/, "")}/admin`,
  });

  return NextResponse.json({
    ok:         result.ok,
    recipient,
    metrics: {
      newLeads24h, newStudents24h, classesToday, classesThisWeek,
      revenueTodayCents: revToday.revenue_cents,
      revenueThisMonthCents: revMonth.revenue_cents,
      unpaidPayrollCents,
      alertsCount: alerts.length,
    },
  });
}

export async function GET(req: Request)  { return runDigest(req); }
export async function POST(req: Request) { return runDigest(req); }
