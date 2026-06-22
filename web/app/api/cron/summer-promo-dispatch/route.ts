import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { sendWhatsappText, isWhatsappBlocked } from "@/lib/whatsapp";
import { getSystemPauseStatus } from "@/lib/system-pause";
import {
  renderPromoMessage,
  MSG1_START_AT, MSG2_AT, MSG3_AT,
  type PromoStep,
} from "@/lib/summer-promo-copy";

/**
 * GET/POST /api/cron/summer-promo-dispatch
 *
 * Cron de la campaña Deutsch im Sommer (Gelfis 2026-06-19).
 *
 * Schedule: `15 * * * *` (cada hora a `:15`).
 *
 * Lógica:
 *   - Gate 1: system_config.summer_promo_enabled.
 *   - Gate 2: sin pausa global.
 *   - Selección de candidatos (Opción A, sin prioridad por nivel):
 *       status NOT IN ('converted','in_conversation','needs_human',
 *                      'trial_scheduled','trial_reminded')
 *       AND whatsapp_normalized IS NOT NULL
 *       AND summer_promo_step < 4
 *       AND NOT (send_failed últimas 24h)
 *     Orden: created_at ASC (más antiguos primero).
 *   - Timing por fechas calendario fijas (no relativo a started_at):
 *       step=0 → msg 1 si NOW >= 2026-06-20 06:00 UTC (sábado 8 AM Berlin)
 *       step=1 → msg 2 si NOW >= 2026-07-02 06:00 UTC (jueves 2 jul 8 AM)
 *       step=2 → msg 3 si NOW >= 2026-07-04 06:00 UTC (viernes 4 jul 8 AM)
 *   - Cap MAX_PER_RUN=10. Pause 5s entre cada send. Hard stop si fallo
 *     parece anti-ban (system_paused/http_5xx/blocked/logged_out).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_PER_RUN = Number(process.env.SUMMER_PROMO_MAX_PER_RUN ?? 10);
const PAUSE_MS    = 5000;
const DAY_MS      = 24 * 3600_000;

function authorised(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const bearer = req.headers.get("authorization");
  if (bearer && bearer.toLowerCase().startsWith("bearer ") && bearer.slice(7).trim() === expected) return true;
  return req.headers.get("x-cron-secret") === expected;
}

type Candidate = {
  id: string;
  name: string | null;
  whatsapp_normalized: string | null;
  summer_promo_step: number;
  created_at: string;
};

async function run(req: Request) {
  if (!authorised(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const sb = supabaseAdmin();

  // ── Gate 1: campaña habilitada ─────────────────────────────────
  const { data: cfg } = await sb.from("system_config").select("value")
    .eq("key", "summer_promo_enabled").maybeSingle();
  const rawVal = (cfg as { value?: unknown } | null)?.value;
  const enabled = rawVal === true || rawVal === "true" || rawVal === '"true"';
  if (!enabled) {
    return NextResponse.json({ ok: true, skipped: "campaign_disabled" });
  }

  // ── Gate 2: pausa global ────────────────────────────────────────
  const pause = await getSystemPauseStatus();
  if (pause.paused) {
    return NextResponse.json({ ok: true, skipped: "global_pause", until: pause.until });
  }

  const now = Date.now();

  // ── Selecciona candidatos brutos (sin prioridad por nivel) ──────
  const { data: rawData, error } = await sb
    .from("leads")
    .select("id, name, whatsapp_normalized, summer_promo_step, created_at")
    .not("whatsapp_normalized", "is", null)
    .not("status", "in", '("converted","in_conversation","needs_human","trial_scheduled","trial_reminded")')
    .lt("summer_promo_step", 4)
    .order("created_at", { ascending: true });
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  const allLeads = (rawData ?? []) as Candidate[];
  if (allLeads.length === 0) {
    return NextResponse.json({ ok: true, scanned: 0, sent: 0 });
  }

  // ── Excluir leads con send_failed últimas 24h (anti-ban) ────────
  const since24h = new Date(now - DAY_MS).toISOString();
  const { data: failed } = await sb.from("lead_timeline")
    .select("lead_id")
    .eq("type", "send_failed")
    .gte("timestamp", since24h)
    .in("lead_id", allLeads.map(l => l.id));
  const failedSet = new Set((failed ?? []).map(r => (r as { lead_id: string }).lead_id));

  // ── Filtra por timing de calendario + blocklist + send_failed ──
  const candidates: Candidate[] = [];
  for (const l of allLeads) {
    if (failedSet.has(l.id)) continue;
    if (isWhatsappBlocked(l.whatsapp_normalized!)) continue;

    const step = l.summer_promo_step;
    if (step === 0) {
      if (now < MSG1_START_AT) continue;  // antes de mañana 8 AM Berlin
    } else if (step === 1) {
      if (now < MSG2_AT) continue;
    } else if (step === 2) {
      if (now < MSG3_AT) continue;
    } else {
      continue; // step 3 o 4 → cadena cerrada
    }
    // Prioridad: step descendente (los que YA empezaron, antes que los nuevos)
    candidates.push(l);
  }
  candidates.sort((a, b) => {
    if (b.summer_promo_step !== a.summer_promo_step) return b.summer_promo_step - a.summer_promo_step;
    return a.created_at.localeCompare(b.created_at);
  });

  // ── Procesa hasta MAX_PER_RUN con pause 5s ─────────────────────
  const results: Array<Record<string, unknown>> = [];
  let sent = 0;
  let errors = 0;

  for (const cand of candidates) {
    if (sent + errors >= MAX_PER_RUN) break;

    const firstName = (cand.name ?? "").trim().split(/\s+/)[0] || (cand.name ?? "");
    const nextStep = (cand.summer_promo_step + 1) as PromoStep;
    const body = renderPromoMessage(nextStep, firstName);

    if (sent + errors > 0) {
      await new Promise(r => setTimeout(r, PAUSE_MS));
    }

    const res = await sendWhatsappText(cand.whatsapp_normalized!, body);
    if (res.ok) {
      const updates: Record<string, unknown> = {
        summer_promo_step: nextStep,
        summer_promo_last_sent_at: new Date().toISOString(),
      };
      if (nextStep === 1) updates.summer_promo_started_at = new Date().toISOString();

      await sb.from("leads").update(updates).eq("id", cand.id);
      await sb.from("lead_timeline").insert({
        lead_id: cand.id,
        type: "system_message_sent",
        author: "system",
        content: body,
        metadata: {
          kind: "summer_promo",
          step: nextStep,
          channel: "whatsapp",
          message_id: res.messageId ?? null,
        },
      });
      sent++;
      results.push({ lead_id: cand.id, step: nextStep, ok: true });
    } else {
      await sb.from("lead_timeline").insert({
        lead_id: cand.id,
        type: "send_failed",
        author: "system",
        content: `💬 Falló summer_promo msg ${nextStep}: ${res.reason}`,
        metadata: { kind: "summer_promo", step: nextStep, reason: res.reason },
      });
      errors++;
      results.push({ lead_id: cand.id, step: nextStep, ok: false, reason: res.reason });

      // Hard stop si parece anti-ban
      if ((res.reason ?? "").match(/system_paused|http_5|blocked|logged.?out/i)) {
        results.push({ stop: true, reason: "send_failure_pattern" });
        break;
      }
    }
  }

  return NextResponse.json({
    ok: true,
    candidates_pool: candidates.length,
    cap: MAX_PER_RUN,
    sent,
    errors,
    results,
  });
}

export async function GET(req: Request)  { return run(req); }
export async function POST(req: Request) { return run(req); }
