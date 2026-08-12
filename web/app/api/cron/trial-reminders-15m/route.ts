import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { sendWhatsappText } from "@/lib/whatsapp";
import { sendTrialReminderEmail } from "@/lib/email/send";
import { buildLeadJoinUrl } from "@/lib/trial-token";

/**
 * GET/POST /api/cron/trial-reminders-15m
 *
 * Nudge final 15 min antes de la clase — WhatsApp + email simultáneos
 * con un único CTA "Únete ahora". El email respalda el WA por si el
 * lead tiene WhatsApp silenciado o no abre la app.
 *
 * - Ventana: 12-18 min antes del start.
 * - Se ejecuta cada 5 min (vercel.json) — la ventana de 6 min absorbe
 *   cualquier deriva del cron.
 * - Idempotencia: marker en classes.notes_admin = "[trial_reminder_15m_sent]".
 *
 * Auth: Authorization: Bearer <CRON_SECRET> o X-Cron-Secret.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REMINDER_TAG = "[trial_reminder_15m_sent]";
const PLATFORM_URL = (process.env.PLATFORM_URL ?? "https://b2c.aprender-aleman.de").replace(/\/$/, "");
const WINDOW_LOW_MS  = 12 * 60_000;
const WINDOW_HIGH_MS = 18 * 60_000;

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

  const nowMs = Date.now();
  const lo = new Date(nowMs).toISOString();
  const hi = new Date(nowMs + 20 * 60_000).toISOString();

  const sb = supabaseAdmin();
  const { data: classes } = await sb
    .from("classes")
    .select(`
      id, scheduled_at, duration_minutes, notes_admin, short_code,
      lead:leads!inner(id, name, language, email, whatsapp_normalized, ai_paused_until, status, reschedule_state)
    `)
    .eq("is_trial", true)
    .eq("status", "scheduled")
    .gte("scheduled_at", lo)
    .lte("scheduled_at", hi);

  type Row = {
    id: string; scheduled_at: string; duration_minutes: number; notes_admin: string | null; short_code: string | null;
    lead: { id: string; name: string; language: "es" | "de"; email: string | null; whatsapp_normalized: string | null; ai_paused_until: string | null; status: string | null; reschedule_state: { phase?: string } | null } |
          Array<{ id: string; name: string; language: "es" | "de"; email: string | null; whatsapp_normalized: string | null; ai_paused_until: string | null; status: string | null; reschedule_state: { phase?: string } | null }>;
  };
  const flat = <T,>(x: T | T[] | null | undefined): T | null => !x ? null : Array.isArray(x) ? x[0] ?? null : x;

  let sentWa = 0, sentEmail = 0, skipped = 0, failed = 0;
  for (const r of (classes ?? []) as Row[]) {
    const startMs = new Date(r.scheduled_at).getTime();
    const msUntil = startMs - nowMs;
    if (msUntil < WINDOW_LOW_MS || msUntil > WINDOW_HIGH_MS) { skipped++; continue; }
    if ((r.notes_admin ?? "").includes(REMINDER_TAG))         { skipped++; continue; }

    const lead = flat(r.lead);
    if (!lead) { skipped++; continue; }

    if (lead.status === "converted") { skipped++; continue; }
    if (lead.reschedule_state?.phase?.startsWith("AWAITING_")) { skipped++; continue; }

    if (lead.ai_paused_until) {
      const until = new Date(lead.ai_paused_until).getTime();
      if (until > nowMs) { skipped++; continue; }
    }

    const leadFirst = (lead.name || "").split(/\s+/)[0] || lead.name || "";
    const joinUrl   = buildLeadJoinUrl({
      classId: r.id, leadId: lead.id, shortCode: r.short_code, baseUrl: PLATFORM_URL,
    });
    const startDate = new Date(r.scheduled_at).toLocaleString(
      lead.language === "de" ? "de-DE" : "es-ES",
      {
        timeZone: "Europe/Berlin",
        weekday: "long", day: "numeric", month: "long",
        hour: "2-digit", minute: "2-digit",
      },
    ) + (lead.language === "de" ? " (Berlin)" : " (Berlín)");

    // ── WhatsApp ──
    let waDelivered = false;
    if (lead.whatsapp_normalized) {
      const waText = lead.language === "de"
        ? `⏰ 15 Minuten bis zu deiner Stunde.\n\nJetzt beitreten: ${joinUrl}`
        : `⏰ 15 minutos para tu clase.\n\nÚnete ahora: ${joinUrl}`;
      const res = await sendWhatsappText(lead.whatsapp_normalized, waText, { kind: "trial_reminder_15m" });
      if (res.ok) { sentWa++; waDelivered = true; }
      else { failed++; console.error(`[trial-reminders-15m] WA failed for ${r.id}: ${res.reason}`); }
    }

    // ── Email ──
    let emailDelivered = false;
    if (lead.email) {
      const res = await sendTrialReminderEmail(lead.email, {
        audience:        "lead",
        // Tono propio "imminent_15m" (Gelfis 2026-06-17): subject
        // "⏰ En 15 min empieza tu clase" + opener urgente.
        tone:            "imminent_15m",
        recipientName:   leadFirst,
        counterpartName: "tu profesor/a",
        startDate,
        durationMin:     r.duration_minutes ?? 40,
        joinUrl,
        language:        lead.language,
      });
      if (res.ok) { sentEmail++; emailDelivered = true; }
      else console.error(`[trial-reminders-15m] email failed for ${r.id}: ${res.error}`);
    }

    if (waDelivered || emailDelivered) {
      const ch: string[] = [];
      if (waDelivered)    ch.push(`💬 WA (${lead.whatsapp_normalized})`);
      if (emailDelivered) ch.push(`✉️ email (${lead.email})`);
      await sb.from("lead_timeline").insert({
        lead_id: lead.id,
        type:    "trial_reminder",
        author:  "system",
        content: `Recordatorio 15 min antes → ${ch.join(" + ")}`,
        metadata: { channel: "multi", kind: "15m_before", class_id: r.id },
      });
      await sb.from("classes")
        .update({ notes_admin: `${r.notes_admin ?? ""}\n${REMINDER_TAG}`.trim() })
        .eq("id", r.id);
    } else if (lead.email || lead.whatsapp_normalized) {
      await sb.from("lead_timeline").insert({
        lead_id: lead.id,
        type:    "send_failed",
        author:  "system",
        content: `❌ Falló el recordatorio 15 min antes`,
        metadata: { channel: "multi", kind: "15m_before", class_id: r.id },
      });
    }
  }

  return NextResponse.json({
    ok: true,
    candidates: classes?.length ?? 0,
    sent_wa:    sentWa,
    sent_email: sentEmail,
    skipped,
    failed,
  });
}
