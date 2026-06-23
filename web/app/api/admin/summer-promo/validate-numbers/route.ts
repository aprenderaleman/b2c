import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * POST /api/admin/summer-promo/validate-numbers
 *
 * Pre-valida TODOS los leads pendientes (summer_promo_step=0 elegibles)
 * contra WhatsApp via Evolution `/chat/whatsappNumbers`. Para los que
 * NO son WA, marca summer_promo_step=4 (excluidos de la cadena) + log
 * para auditoría.
 *
 * Auth: CRON_SECRET.
 * Sin parametros — procesa todos los pendientes.
 *
 * Resultado: { checked, valid, invalid }
 *
 * Llama al webhook server VPS en batches de 50 (rate limit Evolution).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorised(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const bearer = req.headers.get("authorization");
  if (bearer && bearer.toLowerCase().startsWith("bearer ") && bearer.slice(7).trim() === expected) return true;
  return req.headers.get("x-cron-secret") === expected;
}

const BATCH_SIZE   = 50;
const BATCH_PAUSE  = 3000;   // 3s entre batches para no rate-limit Evolution

export async function POST(req: Request) {
  if (!authorised(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const baseUrl = (process.env.AGENTS_BASE_URL ?? "").replace(/\/$/, "");
  const secret  = process.env.AGENTS_INTERNAL_SECRET;
  if (!baseUrl || !secret) {
    return NextResponse.json({ error: "agents_env_missing" }, { status: 503 });
  }

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("leads")
    .select("id, whatsapp_normalized")
    .not("whatsapp_normalized", "is", null)
    .not("status", "in", '("converted","in_conversation","needs_human","trial_scheduled","trial_reminded")')
    .eq("summer_promo_step", 0);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const leads = (data ?? []) as Array<{ id: string; whatsapp_normalized: string }>;
  if (leads.length === 0) {
    return NextResponse.json({ ok: true, checked: 0, valid: 0, invalid: 0, note: "no_pending_leads" });
  }

  let checked = 0;
  let valid   = 0;
  let invalid = 0;
  const invalidLeads: Array<{ id: string; phone: string }> = [];

  for (let i = 0; i < leads.length; i += BATCH_SIZE) {
    const batch = leads.slice(i, i + BATCH_SIZE);
    const phones = batch.map(l => l.whatsapp_normalized);
    let results: Record<string, boolean> = {};
    try {
      const res = await fetch(`${baseUrl}/internal/check-numbers`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Internal-Secret": secret },
        body: JSON.stringify({ phones }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        return NextResponse.json({
          ok: false, partial: { checked, valid, invalid },
          error: `agents_${res.status}`, detail: errBody.slice(0, 200),
        }, { status: 502 });
      }
      const data = await res.json() as { results?: Record<string, boolean> };
      results = data.results ?? {};
    } catch (e) {
      return NextResponse.json({
        ok: false, partial: { checked, valid, invalid },
        error: e instanceof Error ? e.message : "fetch_failed",
      }, { status: 502 });
    }

    // Procesa resultado del batch
    for (const lead of batch) {
      const ok = results[lead.whatsapp_normalized];
      checked++;
      if (ok === false) {
        invalid++;
        invalidLeads.push({ id: lead.id, phone: lead.whatsapp_normalized });
        // Marca como step=4 (excluido) + log timeline.
        await sb.from("leads").update({ summer_promo_step: 4 }).eq("id", lead.id);
        await sb.from("lead_timeline").insert({
          lead_id: lead.id,
          type:    "agent_note",
          author:  "system",
          content: `🚫 Summer promo: número ${lead.whatsapp_normalized} no está en WhatsApp — excluido de la campaña`,
          metadata: { kind: "summer_promo_invalid_wa", phone: lead.whatsapp_normalized },
        });
      } else {
        valid++;
      }
    }

    // Pausa entre batches
    if (i + BATCH_SIZE < leads.length) {
      await new Promise(r => setTimeout(r, BATCH_PAUSE));
    }
  }

  return NextResponse.json({
    ok: true,
    checked,
    valid,
    invalid,
    invalid_sample: invalidLeads.slice(0, 10),
  });
}
