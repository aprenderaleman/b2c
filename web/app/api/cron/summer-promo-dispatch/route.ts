import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { sendWhatsappText, isWhatsappBlocked } from "@/lib/whatsapp";
import { getSystemPauseStatus } from "@/lib/system-pause";
import {
  renderPromoMessage, normaliseLevel, LEVEL_PRIORITY,
  type PromoLevel, type PromoStep,
} from "@/lib/summer-promo-copy";

/**
 * GET/POST /api/cron/summer-promo-dispatch
 *
 * Cron de la campaña Deutsch im Sommer (Gelfis 2026-06-19).
 *
 * Schedule en vercel.json: `15 * * * *` (a 15min de cada hora — fuera del
 * pico de otros crons que corren a en punto).
 *
 * Lógica:
 *   - Si system_config.summer_promo_enabled != 'true' → exit (no opera).
 *   - Si pausa global activa → exit.
 *   - Cap MAX_PER_RUN = 10 (env override). Pause 5s entre cada send.
 *   - Selecciona candidatos por prioridad nivel A0→A1→A2→B1→B2→C1→unknown
 *     y dentro por started_at más antiguo (más viejo prioritario).
 *   - Para cada candidato:
 *       step=0 → manda msg 1, set step=1, started_at=NOW
 *       step=1 con started_at < NOW-4d → manda msg 2, set step=2
 *       step=2 con started_at < NOW-10d → manda msg 3, set step=3
 *
 * Anti-ban defenses:
 *   - Pre-check exists via webhook server (si está disponible).
 *   - Skip leads con send_failed últimas 24h.
 *   - Pause 5s entre sends.
 *   - MAX_PER_RUN duro (10).
 *   - Hard stop si el send fail (no quema todos los slots).
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
  german_level: string | null;
  diagnostico_answers: Record<string, unknown> | null;
  summer_promo_step: number;
  summer_promo_started_at: string | null;
  level: PromoLevel;
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

  // ── Selecciona candidatos brutos ────────────────────────────────
  // Criterio Gelfis 2026-06-19: NO comprado + NO en conversación +
  // NO clase agendada. Filtrado contra send_failed reciente.
  const { data: rawData, error } = await sb
    .from("leads")
    .select("id, name, whatsapp_normalized, german_level, diagnostico_answers, summer_promo_step, summer_promo_started_at")
    .not("whatsapp_normalized", "is", null)
    .not("status", "in", '("converted","in_conversation","needs_human","trial_scheduled","trial_reminded")')
    .lt("summer_promo_step", 4);
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  const allLeads = (rawData ?? []) as Omit<Candidate, "level">[];
  if (allLeads.length === 0) {
    return NextResponse.json({ ok: true, scanned: 0, sent: 0 });
  }

  // ── Excluir leads con send_failed últimas 24h (anti-ban) ────────
  const since24h = new Date(Date.now() - DAY_MS).toISOString();
  const { data: failed } = await sb.from("lead_timeline")
    .select("lead_id")
    .eq("type", "send_failed")
    .gte("timestamp", since24h)
    .in("lead_id", allLeads.map(l => l.id));
  const failedSet = new Set((failed ?? []).map(r => (r as { lead_id: string }).lead_id));

  // ── Normaliza nivel + filtra por timing ─────────────────────────
  const now = Date.now();
  const candidates: Candidate[] = [];
  for (const l of allLeads) {
    if (failedSet.has(l.id)) continue;
    if (isWhatsappBlocked(l.whatsapp_normalized!)) continue;

    // Timing por step
    const step = l.summer_promo_step;
    const startedMs = l.summer_promo_started_at ? new Date(l.summer_promo_started_at).getTime() : null;
    if (step === 0) {
      // msg 1: siempre listo
    } else if (step === 1) {
      // msg 2: esperar 4 días desde started_at
      if (!startedMs || (now - startedMs) < 4 * DAY_MS) continue;
    } else if (step === 2) {
      // msg 3: esperar 10 días desde started_at
      if (!startedMs || (now - startedMs) < 10 * DAY_MS) continue;
    } else {
      continue; // step=3 o 4 → terminado
    }

    candidates.push({
      ...l,
      level: normaliseLevel(l.diagnostico_answers, l.german_level),
    });
  }

  // ── Ordena por prioridad nivel + step + antigüedad ──────────────
  // 1. Step descendente: el lead que YA empezó la cadena tiene prioridad
  //    para no dejarlo a medias (msg 2 antes que msg 1 de uno nuevo).
  // 2. Nivel: A0→A1→A2→B1→B2→C1→unknown.
  // 3. Antigüedad started_at (older first), si NULL va al final.
  const levelRank = (l: PromoLevel) => LEVEL_PRIORITY.indexOf(l);
  candidates.sort((a, b) => {
    if (b.summer_promo_step !== a.summer_promo_step) return b.summer_promo_step - a.summer_promo_step;
    if (levelRank(a.level) !== levelRank(b.level)) return levelRank(a.level) - levelRank(b.level);
    const at = a.summer_promo_started_at ? new Date(a.summer_promo_started_at).getTime() : Infinity;
    const bt = b.summer_promo_started_at ? new Date(b.summer_promo_started_at).getTime() : Infinity;
    return at - bt;
  });

  // ── Procesa hasta MAX_PER_RUN con pause 5s entre cada uno ───────
  const results: Array<Record<string, unknown>> = [];
  let sent = 0;
  let errors = 0;

  for (const cand of candidates) {
    if (sent + errors >= MAX_PER_RUN) break;

    const firstName = (cand.name ?? "").trim().split(/\s+/)[0] || (cand.name ?? "");
    const nextStep = (cand.summer_promo_step + 1) as PromoStep;
    const body = renderPromoMessage(nextStep, firstName, cand.level);

    // Pause 5s entre cada send (skip antes del primero)
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
          level: cand.level,
          channel: "whatsapp",
          message_id: res.messageId ?? null,
        },
      });
      sent++;
      results.push({ lead_id: cand.id, level: cand.level, step: nextStep, ok: true });
    } else {
      await sb.from("lead_timeline").insert({
        lead_id: cand.id,
        type: "send_failed",
        author: "system",
        content: `💬 Falló summer_promo msg ${nextStep}: ${res.reason}`,
        metadata: { kind: "summer_promo", step: nextStep, level: cand.level, reason: res.reason },
      });
      errors++;
      results.push({ lead_id: cand.id, level: cand.level, step: nextStep, ok: false, reason: res.reason });

      // Hard stop si el send falla por system_paused / blocked / 5xx
      // — no quemamos los demás slots. El próximo tick lo retomará.
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
