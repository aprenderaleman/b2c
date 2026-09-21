import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { sendWhatsappText } from "@/lib/whatsapp";
import { resolveChainVariables } from "@/lib/chain-variables";
import { renderTemplate } from "@/lib/message-stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/cron/dormant-monthly-nudge
 *
 * Ping mensual a leads dormant (Gelfis 2026-09-21).
 *
 * Regla del negocio: los leads en `en_reactivacion` o `perdido` que no
 * han convertido y llevan >30 días sin actividad reciben UN mensaje
 * corto al principio de cada mes preguntando si siguen interesados.
 *
 * Schedule (vercel.json): "STAR/15 8-13 1,2,3 STAR STAR" — cada 15 min entre
 * 08:00-13:59 UTC (= 10-16 Berlin CEST) los días 1, 2 y 3 de cada mes.
 * Este batching es necesario porque el rate limit interno de
 * sendWhatsappText es 15s entre envíos → ~20 leads/tick de 5 min. Con
 * 24 ticks/día × 20 leads = 480 leads/día potencial. Cap diario de
 * WhatsApp también aplica (bloquea >300 no-whitelist), por eso reintentos
 * en días 2-3. El dedupe (25 días) evita doble envío entre ticks.
 *
 * Dedupe: se busca timeline entry con kind='dormant_monthly_nudge' en
 * los últimos 25 días. Si existe, skip.
 *
 * Ordering: leads más viejos (más días sin contacto) primero. Cap
 * global de 500 leads por tick (evita cronjob de >5min y respeta el
 * rate limit interno de sendWhatsappText).
 */

function authorised(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const bearer = req.headers.get("authorization");
  if (bearer && bearer.toLowerCase().startsWith("bearer ")) {
    if (bearer.slice(7).trim() === expected) return true;
  }
  return req.headers.get("x-cron-secret") === expected;
}

const MAX_LEADS_PER_TICK = 20;   // limitado por rate limit interno WA (15s/envío × 20 ≈ 5min)
const DORMANT_DAYS = 30;
const DEDUPE_DAYS  = 25;

async function run(req: Request) {
  if (!authorised(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const sb = supabaseAdmin();

  const { data: tpl } = await sb
    .from("message_templates")
    .select("body")
    .eq("kind", "dormant_monthly_nudge")
    .eq("sub_n", 1)
    .eq("channel", "whatsapp")
    .eq("active", true)
    .maybeSingle();
  const templateBody = (tpl as { body?: string } | null)?.body;
  if (!templateBody) {
    return NextResponse.json({ error: "template_missing" }, { status: 500 });
  }

  const now = new Date();
  const dormantCutoff = new Date(now.getTime() - DORMANT_DAYS * 86_400_000).toISOString();
  const dedupeCutoff  = new Date(now.getTime() - DEDUPE_DAYS  * 86_400_000).toISOString();

  // Candidates: leads no-convertidos, estado en_reactivacion o perdido,
  // con última actividad de sistema anterior a `dormantCutoff`. Excluye
  // leads que YA recibieron un dormant_monthly_nudge en los últimos 25d.
  const { data: candidatesRaw, error: candErr } = await sb.rpc(
    "dormant_leads_for_nudge",
    { dormant_cutoff: dormantCutoff, dedupe_cutoff: dedupeCutoff, max_leads: MAX_LEADS_PER_TICK },
  );

  let candidates: Array<{ id: string }>;
  if (candErr) {
    // Fallback si la RPC no existe: query manual (más lento).
    candidates = await fallbackCandidates(sb, dormantCutoff, dedupeCutoff, MAX_LEADS_PER_TICK);
  } else {
    candidates = (candidatesRaw as Array<{ id: string }>) ?? [];
  }

  const results = { total_candidates: candidates.length, sent: 0, skipped_no_wa: 0, failed: 0, errors: [] as string[] };

  for (const c of candidates) {
    const leadId = c.id;

    const { data: leadRow } = await sb
      .from("leads")
      .select("id, name, whatsapp_normalized, language, ai_paused_until")
      .eq("id", leadId)
      .maybeSingle();
    const lead = leadRow as {
      id: string; name: string | null; whatsapp_normalized: string | null;
      language: "es" | "de" | null; ai_paused_until: string | null;
    } | null;
    if (!lead?.whatsapp_normalized) { results.skipped_no_wa++; continue; }
    if (lead.ai_paused_until && new Date(lead.ai_paused_until).getTime() > now.getTime()) {
      results.skipped_no_wa++; continue;
    }

    // Resolve vars (mismo helper que las cadenas para consistencia).
    const vars = await resolveChainVariables(leadId, {}, now.toISOString());
    const text = renderTemplate(templateBody, vars);

    const res = await sendWhatsappText(lead.whatsapp_normalized, text, {
      kind: "dormant_monthly_nudge",
    });

    await sb.from("lead_timeline").insert({
      lead_id: leadId,
      type:    res.ok ? "system_message_sent" : "send_failed",
      author:  "system",
      content: res.ok
        ? text
        : `💬 dormant_monthly_nudge fallo: ${res.reason ?? "unknown"}`,
      metadata: {
        kind:    "dormant_monthly_nudge",
        channel: "whatsapp",
        month:   now.toISOString().slice(0, 7),   // YYYY-MM (auditoría)
      },
    });

    if (res.ok) results.sent++;
    else {
      results.failed++;
      if (res.reason) results.errors.push(res.reason);
    }
  }

  return NextResponse.json({ ok: true, ...results });
}

/**
 * Query manual (fallback si la RPC `dormant_leads_for_nudge` no existe).
 * Regla ampliada 2026-09-21: NO filtramos por estado_cierre — muchos
 * leads dormant reales están en 'sin_asignar' o estados heredados que
 * no serían capturados por 'en_reactivacion'/'perdido'. Solo hace falta
 * que:
 *   - No hayan convertido
 *   - Tengan WhatsApp
 *   - `updated_at` sea antiguo (proxy de inactividad)
 *   - No tengan clase futura scheduled
 *   - No tengan chain activa
 */
async function fallbackCandidates(
  sb: ReturnType<typeof supabaseAdmin>,
  dormantCutoff: string,
  dedupeCutoff: string,
  limit: number,
): Promise<Array<{ id: string }>> {
  const { data: dormant } = await sb
    .from("leads")
    .select("id, updated_at")
    .is("converted_at", null)
    .not("whatsapp_normalized", "is", null)
    .lt("updated_at", dormantCutoff)
    .order("updated_at", { ascending: true })
    .limit(limit * 5);   // margen amplio para descartar los que tienen chain/clase futura o ya nudgeados

  const dormantIds = ((dormant ?? []) as Array<{ id: string }>).map(r => r.id);
  if (dormantIds.length === 0) return [];

  // Excluir leads con chain activa (nudge sería duplicativo).
  const { data: activeChains } = await sb
    .from("lead_chains")
    .select("lead_id")
    .is("completed_at", null)
    .in("lead_id", dormantIds);
  const withActiveChain = new Set(
    ((activeChains ?? []) as Array<{ lead_id: string }>).map(r => r.lead_id),
  );

  // Excluir leads con clase (trial o sesión) futura scheduled.
  const nowIso = new Date().toISOString();
  const { data: futureClasses } = await sb
    .from("classes")
    .select("lead_id")
    .eq("status", "scheduled")
    .gte("scheduled_at", nowIso)
    .in("lead_id", dormantIds);
  const withFutureClass = new Set(
    ((futureClasses ?? []) as Array<{ lead_id: string }>).map(r => r.lead_id),
  );

  // Excluir leads ya nudgeados en el rango de dedupe.
  const { data: recent } = await sb
    .from("lead_timeline")
    .select("lead_id")
    .eq("metadata->>kind", "dormant_monthly_nudge")
    .gte("timestamp", dedupeCutoff)
    .in("lead_id", dormantIds);
  const alreadyNudged = new Set(
    ((recent ?? []) as Array<{ lead_id: string }>).map(r => r.lead_id),
  );

  const eligibleIds = dormantIds.filter(id =>
    !withActiveChain.has(id) && !withFutureClass.has(id) && !alreadyNudged.has(id),
  );
  return eligibleIds.slice(0, limit).map(id => ({ id }));
}

export async function GET(req: Request)  { return run(req); }
export async function POST(req: Request) { return run(req); }
