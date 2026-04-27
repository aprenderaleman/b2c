import { EgressClient } from "livekit-server-sdk";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * Reconciles every recording stuck in `status='processing'` with
 * LiveKit's view of the world. For each row, queries the egress_id and:
 *   - If LiveKit can't find it      → mark 'failed' (egress_not_found_in_livekit).
 *   - If LiveKit says still running → leave it (next run will catch).
 *   - If LiveKit says complete + has a file → flip to 'ready' with file_url,
 *     size, duration filled in.
 *   - If complete but no file       → mark 'failed' (no_file_in_egress_result).
 *
 * Used as the backup path when the LiveKit egress webhook either was
 * never delivered (mis-config), arrived out of order, or failed on a
 * Vercel cold start. Called by:
 *   - POST /api/admin/recordings/reconcile (manual button on /admin/mantenimiento)
 *   - GET  /api/cron/recordings-reconcile  (Vercel Cron, every 15 min)
 *
 * Pure data layer — no auth, no HTTP. Returns the per-row outcomes so
 * the caller can render a summary or just count fixes.
 */
export type ReconcileOutcome =
  | "fixed"
  | "failed"
  | "pending"
  | "not_found"
  | "error";

export type ReconcileResult = {
  egress_id:   string;
  outcome:     ReconcileOutcome;
  file_url?:   string | null;
  size_mb?:    number | null;
  duration_s?: number | null;
  error?:      string | null;
};

export type ReconcileSummary = {
  ok:       boolean;
  reason?:  string;
  checked:  number;
  fixed:    number;
  failed:   number;
  pending:  number;
  errors:   number;
  results:  ReconcileResult[];
};

export async function reconcileStaleRecordings(): Promise<ReconcileSummary> {
  const lkUrl    = process.env.LIVEKIT_URL;
  const lkKey    = process.env.LIVEKIT_API_KEY;
  const lkSecret = process.env.LIVEKIT_API_SECRET;

  if (!lkUrl || !lkKey || !lkSecret) {
    return {
      ok: false, reason: "livekit_not_configured",
      checked: 0, fixed: 0, failed: 0, pending: 0, errors: 0, results: [],
    };
  }

  const httpUrl = lkUrl.replace(/^wss?:\/\//, "https://");
  const client  = new EgressClient(httpUrl, lkKey, lkSecret);
  const sb      = supabaseAdmin();

  const { data: pending, error: queryErr } = await sb
    .from("recordings")
    .select("id, egress_id, class_id")
    .eq("status", "processing");
  if (queryErr) {
    return {
      ok: false, reason: `db_error:${queryErr.message}`,
      checked: 0, fixed: 0, failed: 0, pending: 0, errors: 0, results: [],
    };
  }

  const results: ReconcileResult[] = [];

  for (const r of (pending ?? []) as Array<{ id: string; egress_id: string }>) {
    try {
      const list = await client.listEgress({ egressId: r.egress_id });
      const eg = list[0];
      if (!eg) {
        await sb.from("recordings").update({
          status: "failed", error: "egress_not_found_in_livekit", processed_at: new Date().toISOString(),
        }).eq("id", r.id);
        results.push({ egress_id: r.egress_id, outcome: "not_found" });
        continue;
      }

      // EgressStatus is a numeric protobuf enum at runtime; 3 = EGRESS_COMPLETE.
      const isComplete = (eg.status as unknown) === 3 || (eg.status as unknown) === "EGRESS_COMPLETE";
      if (!isComplete) {
        results.push({ egress_id: r.egress_id, outcome: "pending" });
        continue;
      }

      // EgressInfo's oneof result — the SDK surfaces it as
      // `{ case: "file" | "stream" | "segment", value: {...} }`.
      type FileInfo = { location?: string; size?: string | number; duration?: string | number };
      const result = (eg as unknown as { result?: { case?: string; value?: FileInfo } }).result;
      const f: FileInfo | null =
        result?.case === "file" ? (result.value ?? null) :
        ((eg as unknown as { file?: FileInfo }).file ?? null);

      if (!f?.location) {
        await sb.from("recordings").update({
          status: "failed", error: "no_file_in_egress_result", processed_at: new Date().toISOString(),
        }).eq("id", r.id);
        results.push({ egress_id: r.egress_id, outcome: "failed", error: "no file in result" });
        continue;
      }

      const size      = f.size ? Number(f.size) : null;
      const durNs     = f.duration ? Number(f.duration) : 0;
      const durationS = durNs > 0 ? Math.round(durNs / 1e9) : null;

      await sb.from("recordings").update({
        status:           "ready",
        file_url:         f.location,
        file_size_bytes:  size,
        duration_seconds: durationS,
        processed_at:     new Date().toISOString(),
        error:            null,
      }).eq("id", r.id);

      results.push({
        egress_id:  r.egress_id,
        outcome:    "fixed",
        file_url:   f.location,
        size_mb:    size ? Math.round(size / 1e6) : null,
        duration_s: durationS,
      });
    } catch (e) {
      results.push({
        egress_id: r.egress_id,
        outcome:   "error",
        error:     e instanceof Error ? e.message : "unknown",
      });
    }
  }

  return {
    ok:      true,
    checked: results.length,
    fixed:   results.filter(r => r.outcome === "fixed").length,
    failed:  results.filter(r => r.outcome === "failed" || r.outcome === "not_found").length,
    pending: results.filter(r => r.outcome === "pending").length,
    errors:  results.filter(r => r.outcome === "error").length,
    results,
  };
}
