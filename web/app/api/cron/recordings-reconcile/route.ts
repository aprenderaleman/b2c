import { NextResponse } from "next/server";
import { reconcileStaleRecordings } from "@/lib/recordings-reconcile";

/**
 * GET/POST /api/cron/recordings-reconcile
 *
 * Vercel Cron entry. Runs every 15 minutes (see vercel.json) and
 * sweeps every recording stuck in `status='processing'`, asking
 * LiveKit for the real state and flipping rows to 'ready' or 'failed'
 * accordingly.
 *
 * Why we need this on top of the egress webhook:
 *   - LiveKit fires webhooks once with limited retries. A Vercel cold-
 *     start timeout, a deploy in progress, or a transient 5xx and the
 *     completion event is gone forever.
 *   - egress_started and egress_ended can arrive out of order under
 *     concurrent invocations (Vercel runs them as separate function
 *     boots), which historically left rows stuck in 'processing' even
 *     when the file was already in S3.
 * The cron is the safety net: at most a 15-min wait before the row
 * resolves itself.
 *
 * Auth: same shape as every other cron — Bearer CRON_SECRET (Vercel)
 * or X-Cron-Secret header (manual / curl-from-laptop).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorisedCronRequest(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const bearer = req.headers.get("authorization");
  if (bearer && bearer.toLowerCase().startsWith("bearer ")) {
    if (bearer.slice(7).trim() === expected) return true;
  }
  const xh = req.headers.get("x-cron-secret");
  return xh === expected;
}

export async function GET(req: Request)  { return runCron(req); }
export async function POST(req: Request) { return runCron(req); }

async function runCron(req: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "cron_not_configured" }, { status: 503 });
  }
  if (!authorisedCronRequest(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const summary = await reconcileStaleRecordings();
  if (!summary.ok) {
    return NextResponse.json(
      { error: summary.reason ?? "reconcile_failed" },
      { status: summary.reason === "livekit_not_configured" ? 503 : 500 },
    );
  }

  return NextResponse.json({
    ok:      true,
    checked: summary.checked,
    fixed:   summary.fixed,
    failed:  summary.failed,
    pending: summary.pending,
    errors:  summary.errors,
  });
}
