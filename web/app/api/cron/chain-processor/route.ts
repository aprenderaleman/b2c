import { NextResponse } from "next/server";
import { getPendingChains, advanceChain } from "@/lib/chain-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET/POST /api/cron/chain-processor
 *
 * Cron unificado que procesa todas las cadenas de mensajes post-trial.
 * Cada ejecución busca cadenas con next_fire_at <= NOW() y que no
 * estén pausadas, luego ejecuta el step correspondiente.
 *
 * Frecuencia recomendada: cada 5-10 minutos.
 */
export async function GET()  { return run(); }
export async function POST() { return run(); }

async function run() {
  const chains = await getPendingChains();
  if (chains.length === 0) {
    return NextResponse.json({ ok: true, processed: 0 });
  }

  const results: Array<{ chain_id: string; lead_id: string; action: string; template?: string }> = [];

  for (const chain of chains) {
    try {
      const result = await advanceChain(chain);
      results.push({
        chain_id: chain.id,
        lead_id: chain.lead_id,
        action: result.action,
        template: result.templateKind,
      });
    } catch (err) {
      console.error(`[chain-processor] Error processing chain ${chain.id}:`, err);
      results.push({
        chain_id: chain.id,
        lead_id: chain.lead_id,
        action: "error",
      });
    }
  }

  return NextResponse.json({ ok: true, processed: chains.length, results });
}
