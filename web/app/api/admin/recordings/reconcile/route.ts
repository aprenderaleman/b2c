import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { EgressClient } from "livekit-server-sdk";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * POST /api/admin/recordings/reconcile
 *
 * Backup for the LiveKit egress webhook. Walks every recording in
 * status='processing', queries LiveKit for its real state, and
 * flips the row to 'ready' (with file_url / size / duration) or
 * 'failed' based on what LiveKit reports.
 *
 * Useful if:
 *   - The LiveKit Cloud webhook isn't configured (or is mis-configured).
 *   - The webhook call failed and we missed the completion event.
 *   - A network blip dropped the signed payload.
 *
 * Admin-only. Returns a per-recording summary for display.
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

  const lkUrl    = process.env.LIVEKIT_URL;
  const lkKey    = process.env.LIVEKIT_API_KEY;
  const lkSecret = process.env.LIVEKIT_API_SECRET;
  if (!lkUrl || !lkKey || !lkSecret) {
    return NextResponse.json({ error: "livekit_not_configured" }, { status: 503 });
  }
  const httpUrl = lkUrl.replace(/^wss?:\/\//, "https://");
  const client  = new EgressClient(httpUrl, lkKey, lkSecret);

  const sb = supabaseAdmin();
  const { data: pending, error: queryErr } = await sb
    .from("recordings")
    .select("id, egress_id, class_id")
    .eq("status", "processing");
  if (queryErr) {
    return NextResponse.json({ error: "db_error", message: queryErr.message }, { status: 500 });
  }

  type Result = {
    egress_id: string;
    outcome:   "fixed" | "failed" | "pending" | "not_found" | "error";
    file_url?: string | null;
    size_mb?:  number | null;
    duration_s?: number | null;
    error?:    string | null;
  };
  const results: Result[] = [];

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

      // Still running — leave it alone for the next reconcile run.
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

  const summary = {
    checked: results.length,
    fixed:   results.filter(r => r.outcome === "fixed").length,
    failed:  results.filter(r => r.outcome === "failed" || r.outcome === "not_found").length,
    pending: results.filter(r => r.outcome === "pending").length,
    errors:  results.filter(r => r.outcome === "error").length,
  };

  return NextResponse.json({ ok: true, summary, results });
}
