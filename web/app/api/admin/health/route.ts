import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * GET /api/admin/health
 *
 * Light-weight probe of the self-healing status used by the traffic-light
 * indicator in the admin header. Returns:
 *
 *   { status: "green" | "yellow" | "red",
 *     critical: string | null,
 *     services: [{ service, last_tick, minutes_since, state }] }
 *
 * Rules:
 *   - If system_config.last_critical_issue is set → red.
 *   - If any heartbeat is > 30 min old → red (something's frozen).
 *   - If any heartbeat is > 20 min old → yellow (warning zone).
 *   - Else green.
 *
 * Gated to authenticated admins only. Polling friendly: this costs ≈ 2
 * tiny queries per call, no JOINs.
 */

const STALE_WARN_MIN     = 20;
const STALE_CRITICAL_MIN = 30;

export async function GET() {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (!session?.user || !(role === "admin" || role === "superadmin")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const sb = supabaseAdmin();

  const [{ data: cfg }, { data: beats }] = await Promise.all([
    sb.from("system_config").select("value").eq("key", "last_critical_issue").maybeSingle(),
    sb.from("system_heartbeat").select("service, last_tick, last_note"),
  ]);

  const critical = ((cfg?.value as string | undefined) ?? "").trim();

  const now = Date.now();
  type BeatRow = { service: string; last_tick: string; last_note: string | null };
  const services = ((beats ?? []) as BeatRow[]).map(b => {
    const minutes = (now - new Date(b.last_tick).getTime()) / 60_000;
    const state =
      minutes > STALE_CRITICAL_MIN ? "red"    :
      minutes > STALE_WARN_MIN     ? "yellow" :
                                     "green";
    return {
      service:       b.service,
      last_tick:     b.last_tick,
      minutes_since: Math.round(minutes),
      last_note:     b.last_note,
      state,
    };
  });

  // Roll up: red if anything red or a critical issue is flagged; yellow if
  // any warning; else green.
  let rollup: "green" | "yellow" | "red" = "green";
  if (critical) rollup = "red";
  for (const s of services) {
    if (s.state === "red")              rollup = "red";
    else if (s.state === "yellow" && rollup === "green") rollup = "yellow";
  }

  return NextResponse.json(
    {
      status:   rollup,
      critical: critical || null,
      services,
    },
    {
      // No client-side HTTP cache; we want the dot to reflect live state.
      headers: { "Cache-Control": "no-store" },
    },
  );
}
