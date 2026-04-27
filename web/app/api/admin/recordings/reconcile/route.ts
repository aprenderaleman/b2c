import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { reconcileStaleRecordings } from "@/lib/recordings-reconcile";

/**
 * POST /api/admin/recordings/reconcile
 *
 * Manual trigger for the recording-reconcile sweep. Walks every row in
 * `recordings` with status='processing', queries LiveKit, and flips
 * the row to 'ready' (with file_url / size / duration) or 'failed'
 * based on what LiveKit reports.
 *
 * Useful as a self-service "rescue" button on /admin/mantenimiento for
 * recordings that the egress webhook missed (out-of-order delivery,
 * cold-start drop, mis-config). The same logic runs every 15 minutes
 * via /api/cron/recordings-reconcile, so this endpoint is mainly for
 * "fix it RIGHT NOW" without waiting for the cron tick.
 *
 * Admin-only.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const role = (session.user as { role?: string }).role;
  if (role !== "admin" && role !== "superadmin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const summary = await reconcileStaleRecordings();
  if (!summary.ok) {
    return NextResponse.json(
      { error: summary.reason ?? "reconcile_failed" },
      { status: summary.reason === "livekit_not_configured" ? 503 : 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    summary: {
      checked: summary.checked,
      fixed:   summary.fixed,
      failed:  summary.failed,
      pending: summary.pending,
      errors:  summary.errors,
    },
    results: summary.results,
  });
}
