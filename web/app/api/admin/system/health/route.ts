import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * GET /api/admin/system/health
 *
 * Aggregates everything an admin needs to know "is the messaging
 * pipeline healthy right now?" into one JSON payload:
 *
 *   - Evolution API connection state (live HTTP call to the agents
 *     bridge if AGENTS_BASE_URL is configured).
 *   - Last inbound + outbound timestamps from lead_timeline.
 *   - Stuck-lead counts (status active + last_event > N hours).
 *   - Recent send_failed counts.
 *
 * The `/admin/system` page polls this every ~15 s. Read-only — no
 * mutations. Admin/superadmin gated.
 */
export const runtime  = "nodejs";
export const dynamic  = "force-dynamic";

type EvolutionState =
  | { state: "open" | "connecting" | "close" | "unknown"; via: "agents" | "evolution" | "skip"; error?: string };

async function probeEvolution(): Promise<EvolutionState> {
  const baseUrl = process.env.AGENTS_BASE_URL?.replace(/\/$/, "");
  const secret  = process.env.AGENTS_INTERNAL_SECRET;
  if (!baseUrl || !secret) return { state: "unknown", via: "skip" };
  try {
    const r = await fetch(`${baseUrl}/internal/whatsapp-status`, {
      method: "GET",
      headers: { "X-Internal-Secret": secret },
      signal: AbortSignal.timeout(5_000),
    });
    if (!r.ok) {
      return { state: "unknown", via: "agents", error: `http_${r.status}` };
    }
    const data = await r.json().catch(() => ({})) as { state?: string };
    const s = (data.state ?? "unknown") as EvolutionState["state"];
    return { state: s, via: "agents" };
  } catch (e) {
    return { state: "unknown", via: "agents", error: e instanceof Error ? e.message : "unknown" };
  }
}

export async function GET() {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (!session?.user || (role !== "admin" && role !== "superadmin")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const sb = supabaseAdmin();
  const now = Date.now();

  // Queue snapshot (table from migration 040). Counts by status.
  const queuePromise = sb
    .from("outbound_queue")
    .select("status", { count: "exact", head: false })
    .then(({ data }) => {
      const counts: Record<string, number> = { queued: 0, sent: 0, failed_permanent: 0 };
      for (const row of (data ?? []) as Array<{ status: string }>) {
        counts[row.status] = (counts[row.status] ?? 0) + 1;
      }
      return counts;
    }, () => ({ queued: -1, sent: -1, failed_permanent: -1 }));   // -1 = table missing

  const [evo, lastInbound, lastOutbound, failed24h, stuckLeads, queue] = await Promise.all([
    probeEvolution(),
    sb.from("lead_timeline")
      .select("timestamp")
      .eq("type", "lead_message_received")
      .order("timestamp", { ascending: false })
      .limit(1)
      .maybeSingle(),
    sb.from("lead_timeline")
      .select("timestamp")
      .eq("type", "system_message_sent")
      .order("timestamp", { ascending: false })
      .limit(1)
      .maybeSingle(),
    sb.from("lead_timeline")
      .select("id", { count: "exact", head: true })
      .eq("type", "send_failed")
      .gte("timestamp", new Date(now - 24 * 3600_000).toISOString()),
    // "Stuck" = status active + last lead_timeline event > 24h ago.
    sb.rpc("admin_stuck_leads_count").then(r => r, () => ({ data: null, error: { message: "rpc_missing" } })),
    queuePromise,
  ]);

  const lastInboundIso  = (lastInbound.data  as { timestamp?: string } | null)?.timestamp ?? null;
  const lastOutboundIso = (lastOutbound.data as { timestamp?: string } | null)?.timestamp ?? null;
  const failedCount     = failed24h.count ?? 0;

  // Quick-and-dirty stuck count if RPC missing.
  let stuck = (stuckLeads as { data?: number } | null)?.data ?? null;
  if (stuck === null) {
    const { data: stuckRows } = await sb
      .from("leads")
      .select("id, updated_at")
      .not("status", "in", "(lost,converted,needs_human)")
      .lt("updated_at", new Date(now - 48 * 3600_000).toISOString())
      .limit(200);
    stuck = (stuckRows ?? []).length;
  }

  // Health verdicts — used by the dashboard to colour the chip.
  const inboundAgeMs  = lastInboundIso  ? now - new Date(lastInboundIso).getTime()  : null;
  const outboundAgeMs = lastOutboundIso ? now - new Date(lastOutboundIso).getTime() : null;

  const evolutionOk = evo.state === "open";
  const inboundConcern  = inboundAgeMs  !== null && inboundAgeMs  > 6 * 3600_000;
  const outboundConcern = outboundAgeMs !== null && outboundAgeMs > 6 * 3600_000;

  return NextResponse.json({
    ok: true,
    now: new Date(now).toISOString(),
    evolution: evo,
    inbound: {
      lastAt: lastInboundIso,
      ageSec: inboundAgeMs ? Math.round(inboundAgeMs / 1000) : null,
      concern: inboundConcern,
    },
    outbound: {
      lastAt: lastOutboundIso,
      ageSec: outboundAgeMs ? Math.round(outboundAgeMs / 1000) : null,
      concern: outboundConcern,
    },
    failed24h: failedCount,
    stuckLeads: stuck,
    queue,
    overall: evolutionOk && !inboundConcern && !outboundConcern && failedCount < 3 && (queue?.queued ?? 0) === 0 ? "ok" : "warn",
  });
}
