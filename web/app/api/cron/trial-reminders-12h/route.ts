import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { sendWhatsappText } from "@/lib/whatsapp";
import { buildLeadJoinUrl } from "@/lib/trial-token";

/**
 * GET/POST /api/cron/trial-reminders-12h
 *
 * Vercel Cron hits this hourly. Para cada trial agendado en ventana
 * 11-13h desde ahora, envía un WhatsApp breve "noche antes" al lead.
 * Sólo WhatsApp — el lead ya tiene tres emails (confirmación, 24h, y
 * 8h matutino) y un cuarto sería ruido.
 *
 * Pensado para clases mañaneras: si la clase es a las 10:00 CEST,
 * este cron dispara la noche antes a las ~22:00 — un nudge final
 * antes de dormir.
 *
 * Auth: Authorization: Bearer <CRON_SECRET> o X-Cron-Secret.
 *
 * Idempotency: marker en classes.notes_admin = "[trial_reminder_12h_sent]".
 */
export const runtime  = "nodejs";
export const dynamic  = "force-dynamic";

const REMINDER_TAG = "[trial_reminder_12h_sent]";
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
  const lo  = new Date(now + 11 * 3600_000).toISOString();
  const hi  = new Date(now + 13 * 3600_000).toISOString();

  const sb = supabaseAdmin();
  const { data: classes } = await sb
    .from("classes")
    .select(`
      id, scheduled_at, duration_minutes, notes_admin, short_code,
      lead:leads!inner(id, name, language, whatsapp_normalized, ai_paused_until)
    `)
    .eq("is_trial", true)
    .eq("status", "scheduled")
    .gte("scheduled_at", lo)
    .lte("scheduled_at", hi);

  type Row = {
    id: string; scheduled_at: string; duration_minutes: number; notes_admin: string | null; short_code: string | null;
    lead: { id: string; name: string; language: "es" | "de"; whatsapp_normalized: string | null; ai_paused_until: string | null } |
          Array<{ id: string; name: string; language: "es" | "de"; whatsapp_normalized: string | null; ai_paused_until: string | null }>;
  };
  const flat = <T,>(x: T | T[] | null | undefined): T | null => !x ? null : Array.isArray(x) ? x[0] ?? null : x;

  let sent = 0, skipped = 0;
  for (const r of (classes ?? []) as Row[]) {
    if ((r.notes_admin ?? "").includes(REMINDER_TAG)) { skipped++; continue; }

    const lead = flat(r.lead);
    if (!lead || !lead.whatsapp_normalized) { skipped++; continue; }

    if (lead.ai_paused_until && new Date(lead.ai_paused_until).getTime() > Date.now()) {
      skipped++; continue;
    }

    const leadFirst = (lead.name || "").split(/\s+/)[0] || lead.name || "";
    const timeLabel = new Date(r.scheduled_at).toLocaleString(
      lead.language === "de" ? "de-DE" : "es-ES",
      { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" },
    );

    const leadJoinUrl = buildLeadJoinUrl({
      classId: r.id, leadId: lead.id, shortCode: r.short_code, baseUrl: PLATFORM_URL,
    });

    const waText = lead.language === "de"
      ? `Erinnerung ${leadFirst}: morgen Deutsch-Stunde um ${timeLabel}.\nDein Link: ${leadJoinUrl}`
      : `Recordatorio ${leadFirst}: mañana clase de alemán a las ${timeLabel}.\nTu link: ${leadJoinUrl}`;

    const wa = await sendWhatsappText(lead.whatsapp_normalized, waText);
    if (!wa.ok) {
      console.error(`[trial-reminders-12h] WA failed for ${r.id}: ${wa.reason}`);
      continue;
    }
    sent++;

    await sb.from("lead_timeline").insert({
      lead_id: lead.id,
      type:    "trial_reminder",
      author:  "system",
      content: `💬 Recordatorio WhatsApp 12h antes (noche)`,
      metadata: { channel: "whatsapp", kind: "12h_before_night", class_id: r.id },
    });

    await sb.from("classes")
      .update({ notes_admin: `${r.notes_admin ?? ""}\n${REMINDER_TAG}`.trim() })
      .eq("id", r.id);
  }

  return NextResponse.json({
    ok: true,
    candidates: classes?.length ?? 0,
    sent,
    skipped,
  });
}
