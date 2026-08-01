import { supabaseAdmin } from "./supabase";
import { startChain } from "./chain-engine";

export type ReactivationResult = {
  total_candidates: number;
  assigned: number;
  skipped: number;
  batch_id: string;
};

export async function triggerReactivationBatch(
  closerId: string,
  opts: { maxLeads?: number; daysBack?: number } = {},
): Promise<ReactivationResult> {
  const sb = supabaseAdmin();
  const maxLeads = opts.maxLeads ?? 50;
  const daysBack = opts.daysBack ?? 90;
  const since = new Date(Date.now() - daysBack * 86_400_000).toISOString();
  const batchId = crypto.randomUUID();

  const { data: candidates } = await sb
    .from("leads")
    .select("id, name, closer_id, estado_cierre")
    .in("estado_cierre", ["perdido", "en_reactivacion"])
    .is("converted_to_user_id", null)
    .gte("created_at", since)
    .is("reactivation_batch_id", null)
    .order("created_at", { ascending: false })
    .limit(maxLeads);

  const leads = (candidates ?? []) as Array<{
    id: string;
    name: string | null;
    closer_id: string | null;
    estado_cierre: string;
  }>;

  let assigned = 0;
  let skipped = 0;

  for (const lead of leads) {
    const { data: activeChain } = await sb
      .from("lead_chains")
      .select("id")
      .eq("lead_id", lead.id)
      .is("completed_at", null)
      .limit(1)
      .maybeSingle();

    if (activeChain) {
      skipped++;
      continue;
    }

    await sb.from("leads").update({
      closer_id: closerId,
      estado_cierre: "en_reactivacion",
      reactivation_source: "reactivacion_backlog",
      reactivation_batch_id: batchId,
    }).eq("id", lead.id);

    await startChain(lead.id, "chain8g_reactivacion", {
      source: "reactivacion_backlog",
      batch_id: batchId,
    });

    await sb.from("lead_timeline").insert({
      lead_id: lead.id,
      type: "status_change",
      author: "system",
      content: `Reactivación batch: asignado a closer para seguimiento`,
      metadata: {
        kind: "reactivation_batch",
        closer_id: closerId,
        batch_id: batchId,
      },
    });

    assigned++;
  }

  return {
    total_candidates: leads.length,
    assigned,
    skipped,
    batch_id: batchId,
  };
}
