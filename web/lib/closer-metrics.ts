import { supabaseAdmin } from "./supabase";

export type SpeedToLeadResult = {
  count: number;
  avg_minutes: number;
  median_minutes: number;
  p90_minutes: number;
};

export async function getSpeedToLead(
  desde: Date,
  hasta: Date,
): Promise<SpeedToLeadResult> {
  const sb = supabaseAdmin();

  const { data: tasks } = await sb
    .from("tareas_closer")
    .select("id, closer_id, lead_id, created_at, fecha_completada")
    .gte("created_at", desde.toISOString())
    .lt("created_at", hasta.toISOString())
    .not("fecha_completada", "is", null);

  const taskRows = (tasks ?? []) as Array<{
    id: string;
    closer_id: string;
    lead_id: string;
    created_at: string;
    fecha_completada: string;
  }>;

  const { data: actions } = await sb
    .from("acciones_closer")
    .select("closer_id, lead_id, created_at")
    .gte("created_at", desde.toISOString())
    .lt("created_at", hasta.toISOString());

  const actionRows = (actions ?? []) as Array<{
    closer_id: string;
    lead_id: string;
    created_at: string;
  }>;

  const actionsByLeadCloser = new Map<string, number>();
  for (const a of actionRows) {
    const key = `${a.lead_id}::${a.closer_id}`;
    const ts = new Date(a.created_at).getTime();
    const existing = actionsByLeadCloser.get(key);
    if (!existing || ts < existing) {
      actionsByLeadCloser.set(key, ts);
    }
  }

  const deltas: number[] = [];
  for (const t of taskRows) {
    const key = `${t.lead_id}::${t.closer_id}`;
    const firstAction = actionsByLeadCloser.get(key);
    if (firstAction) {
      const taskCreated = new Date(t.created_at).getTime();
      const delta = firstAction - taskCreated;
      if (delta >= 0) {
        deltas.push(delta);
      }
    }
  }

  if (deltas.length === 0) {
    return { count: 0, avg_minutes: 0, median_minutes: 0, p90_minutes: 0 };
  }

  deltas.sort((a, b) => a - b);
  const toMin = (ms: number) => Math.round(ms / 60_000);
  const avg = deltas.reduce((s, d) => s + d, 0) / deltas.length;
  const median = deltas[Math.floor(deltas.length / 2)];
  const p90 = deltas[Math.floor(deltas.length * 0.9)];

  return {
    count: deltas.length,
    avg_minutes: toMin(avg),
    median_minutes: toMin(median),
    p90_minutes: toMin(p90),
  };
}

export type ChainFunnelEntry = {
  chain_type: string;
  started: number;
  completed: number;
  cancelled: number;
  active: number;
  conversion_rate: number;
};

export async function getChainFunnel(
  desde: Date,
  hasta: Date,
): Promise<ChainFunnelEntry[]> {
  const sb = supabaseAdmin();

  const { data: chains } = await sb
    .from("lead_chains")
    .select("chain_type, completed_at, cancel_reason")
    .gte("created_at", desde.toISOString())
    .lt("created_at", hasta.toISOString());

  const rows = (chains ?? []) as Array<{
    chain_type: string;
    completed_at: string | null;
    cancel_reason: string | null;
  }>;

  const buckets = new Map<string, { started: number; completed: number; cancelled: number; active: number }>();

  for (const r of rows) {
    let b = buckets.get(r.chain_type);
    if (!b) {
      b = { started: 0, completed: 0, cancelled: 0, active: 0 };
      buckets.set(r.chain_type, b);
    }
    b.started++;
    if (!r.completed_at) {
      b.active++;
    } else if (r.cancel_reason === "converted_stripe_auto" || r.cancel_reason === "converted") {
      b.completed++;
    } else {
      b.cancelled++;
    }
  }

  const result: ChainFunnelEntry[] = [];
  for (const [chain_type, b] of buckets) {
    result.push({
      chain_type,
      ...b,
      conversion_rate: b.started > 0 ? Math.round((b.completed / b.started) * 10000) / 100 : 0,
    });
  }

  result.sort((a, b) => b.started - a.started);
  return result;
}
