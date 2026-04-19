import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { livekitConfigured, livekitUrl } from "@/lib/livekit";

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

  // Lightweight infra status (LiveKit) — booleans, not a critical-dot input.
  const infra = {
    livekit: {
      configured: livekitConfigured(),
      url:        livekitConfigured() ? livekitUrl() : null,
    },
  };

  // --- LMS-specific health (feeds the blue dot in the admin header) ----
  // The blue dot is blue when everything the LMS needs is green:
  //   - DB reachable (implicit — we're already here)
  //   - LiveKit configured
  //   - At least 1 upcoming scheduled class in the next 7 days
  //   - No class stuck in 'live' status for >3 hours (would mean a
  //     teacher forgot to end it)
  const [
    { count: upcomingCount },
    { count: stuckCount },
  ] = await Promise.all([
    sb.from("classes")
      .select("id", { head: true, count: "exact" })
      .eq("status", "scheduled")
      .gte("scheduled_at", new Date().toISOString())
      .lte("scheduled_at", new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString()),
    sb.from("classes")
      .select("id", { head: true, count: "exact" })
      .eq("status", "live")
      .lt("started_at", new Date(Date.now() - 3 * 3600 * 1000).toISOString()),
  ]);
  const lms = {
    livekit_configured: livekitConfigured(),
    db_ok:              true,
    upcoming_7d:        upcomingCount ?? 0,
    stuck_live_classes: stuckCount ?? 0,
    ok:
      livekitConfigured() &&
      (upcomingCount ?? 0) > 0 &&
      (stuckCount ?? 0) === 0,
  };

  return NextResponse.json(
    {
      status:   rollup,
      critical: critical || null,
      services,
      infra,
      lms,
    },
    {
      // No client-side HTTP cache; we want the dot to reflect live state.
      headers: { "Cache-Control": "no-store" },
    },
  );
}
