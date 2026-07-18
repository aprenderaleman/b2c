import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolveRecipients } from "@/lib/comunicados/audience";
import { dispatchSequentially, summariseResults, loadAttachments, dripBatchSize, SEND_PACING_MS } from "@/lib/comunicados/send";
import { audienceFilterSchema, attachmentsArraySchema } from "@/lib/comunicados/schema";
import type { Attachment, AudienceFilter, Channel, Recipient, SendResultRow } from "@/lib/comunicados/types";

/**
 * GET/POST /api/cron/comunicados-dispatch
 *
 * Runs every 5 minutes (vercel.json). Picks up any admin_broadcasts row
 * with status='queued' and scheduled_at <= now(), claims it atomically,
 * resolves the audience FRESH at send time (so recently-added students
 * are included), sends, and writes the per-recipient results back.
 *
 * Auth — same pattern as the other crons in this app:
 *   Authorization: Bearer <CRON_SECRET>   (set by Vercel Cron)
 *   X-Cron-Secret: <CRON_SECRET>          (manual / external)
 *
 * Idempotency / race-safety:
 *   We claim a row by UPDATE ... WHERE status='queued' RETURNING. If a
 *   concurrent invocation already claimed it the UPDATE returns nothing
 *   and we move on. Each row is only ever sent once.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Vercel functions on the hobby/pro plan have a max duration; one row
// can take a while if the audience is large. Cap how many we process
// per cron tick so we never blow past the timeout. The cron runs every
// 5 minutes so backlog drains quickly even with a small batch.
const MAX_ROWS_PER_TICK = 5;

function authorisedCronRequest(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const bearer = req.headers.get("authorization");
  if (bearer && bearer.toLowerCase().startsWith("bearer ")) {
    if (bearer.slice(7).trim() === expected) return true;
  }
  return req.headers.get("x-cron-secret") === expected;
}

export async function GET(req: Request)  { return runDispatch(req); }
export async function POST(req: Request) { return runDispatch(req); }

async function runDispatch(req: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "cron_secret_not_configured" }, { status: 500 });
  }
  if (!authorisedCronRequest(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const sb = supabaseAdmin();

  const now = new Date().toISOString();

  // 1a. Find queued rows due for dispatch.
  const { data: due, error: findErr } = await sb
    .from("admin_broadcasts")
    .select("id")
    .eq("status", "queued")
    .lte("scheduled_at", now)
    .order("scheduled_at", { ascending: true })
    .limit(MAX_ROWS_PER_TICK);

  if (findErr) {
    return NextResponse.json({ error: "db_error", message: findErr.message }, { status: 500 });
  }

  // 1b. Find in-progress drip rows whose next batch window has opened.
  //     next_batch_at <= now means the drip lock has expired.
  const slotsLeft = MAX_ROWS_PER_TICK - (due ?? []).length;
  const { data: drip } = slotsLeft > 0
    ? await sb
        .from("admin_broadcasts")
        .select("id")
        .eq("status", "sending")
        .lte("next_batch_at", now)
        .order("next_batch_at", { ascending: true })
        .limit(slotsLeft)
    : { data: [] };

  const allIds = [
    ...((due ?? []).map(r => ({ id: r.id, mode: "queued" as const }))),
    ...((drip ?? []).map(r => ({ id: r.id, mode: "drip"   as const }))),
  ];

  const processed: Array<{ id: string; ok: boolean; total: number; ok_count: number; fail_count: number; dispatched?: number; remaining?: number; error?: string }> = [];

  for (const { id, mode } of allIds) {
    if (mode === "queued") {
      // 2a. Atomically claim queued → sending.
      const { data: claimed, error: claimErr } = await sb
        .from("admin_broadcasts")
        .update({ status: "sending" })
        .eq("id", id)
        .eq("status", "queued")
        .select("id, audience_filter, subject, message_markdown, channels, attachments, pacing_ms, dispatched_count, ok_count, fail_count")
        .maybeSingle();
      if (claimErr) { processed.push({ id, ok: false, total: 0, ok_count: 0, fail_count: 0, error: `claim:${claimErr.message}` }); continue; }
      if (!claimed) continue; // race-claimed by another invocation

      await processBroadcast(sb, claimed, processed);

    } else {
      // 2b. Atomically claim a drip row by pushing next_batch_at 10 min
      //     into the future — this acts as a distributed lock so two
      //     overlapping cron invocations don't double-dispatch.
      const lockUntil = new Date(Date.now() + 10 * 60_000).toISOString();
      const { data: claimed, error: claimErr } = await sb
        .from("admin_broadcasts")
        .update({ next_batch_at: lockUntil })
        .eq("id", id)
        .eq("status", "sending")
        .lte("next_batch_at", now)
        .select("id, audience_filter, subject, message_markdown, channels, attachments, pacing_ms, dispatched_count, total_recipients, ok_count, fail_count")
        .maybeSingle();
      if (claimErr) { processed.push({ id, ok: false, total: 0, ok_count: 0, fail_count: 0, error: `drip_claim:${claimErr.message}` }); continue; }
      if (!claimed) continue;

      await processBroadcast(sb, claimed, processed);
    }
  }

  return NextResponse.json({
    ok: true,
    processed,
    found: allIds.length,
  });
}

// ---------------------------------------------------------------------------
// processBroadcast — shared by both queued→first-batch and drip→next-batch.
// ---------------------------------------------------------------------------
type ClaimedRow = {
  id:               string;
  audience_filter:  unknown;
  subject:          string;
  message_markdown: string;
  channels:         string[];
  attachments:      unknown;
  pacing_ms:        number | null;
  dispatched_count: number | null;
  total_recipients?: number | null;
  ok_count:         number | null;
  fail_count:       number | null;
};

type ProcessedEntry = {
  id: string; ok: boolean; total: number; ok_count: number; fail_count: number;
  dispatched?: number; remaining?: number; error?: string;
};

async function processBroadcast(
  sb:        ReturnType<typeof supabaseAdmin>,
  claimed:   ClaimedRow,
  processed: ProcessedEntry[],
): Promise<void> {
  const id = claimed.id;

  const filterParsed = audienceFilterSchema.safeParse(claimed.audience_filter);
  if (!filterParsed.success) {
    await sb.from("admin_broadcasts")
      .update({ status: "failed", results: [{ error: "invalid_audience_filter" }] })
      .eq("id", id);
    processed.push({ id, ok: false, total: 0, ok_count: 0, fail_count: 0, error: "invalid_audience_filter" });
    return;
  }
  const filter:   AudienceFilter = filterParsed.data;
  const channels: Channel[]      = (claimed.channels ?? []).filter(
    (c: string): c is Channel => c === "email" || c === "whatsapp",
  );

  const attachmentsParsed = attachmentsArraySchema.safeParse(claimed.attachments ?? []);
  const attachments: Attachment[] = attachmentsParsed.success ? attachmentsParsed.data : [];

  const pacingMs    = claimed.pacing_ms    ?? SEND_PACING_MS;
  const batchSize   = dripBatchSize(pacingMs);
  const startOffset = claimed.dispatched_count ?? 0;
  const prevOk      = claimed.ok_count    ?? 0;
  const prevFail    = claimed.fail_count  ?? 0;

  let recipients: Recipient[];
  try {
    recipients = await resolveRecipients(filter);
  } catch (e) {
    const error = e instanceof Error ? e.message : "resolve_failed";
    await sb.from("admin_broadcasts")
      .update({ status: "failed", results: [{ error }] })
      .eq("id", id);
    processed.push({ id, ok: false, total: 0, ok_count: 0, fail_count: 0, error });
    return;
  }

  const loadedAttachments = await loadAttachments(attachments);

  // Slice the batch to process this tick.
  const batch = batchSize === Infinity
    ? recipients.slice(startOffset)
    : recipients.slice(startOffset, startOffset + batchSize);

  let results: SendResultRow[] = [];
  let dispatchError: string | null = null;
  try {
    results = await dispatchSequentially(
      batch, claimed.subject, claimed.message_markdown, channels, loadedAttachments, pacingMs,
    );
  } catch (e) {
    dispatchError = e instanceof Error ? e.message : "dispatch_failed";
  }

  const { ok_count: batchOk, fail_count: batchFail } = summariseResults(results);
  const totalOk   = prevOk   + batchOk;
  const totalFail = prevFail + batchFail;
  const newDispatched = startOffset + results.length;
  const isDone = !!dispatchError || batchSize === Infinity || newDispatched >= recipients.length;

  if (isDone) {
    await sb.from("admin_broadcasts")
      .update({
        status:           dispatchError ? "failed" : "sent",
        total_recipients: recipients.length,
        ok_count:         totalOk,
        fail_count:       totalFail,
        dispatched_count: newDispatched,
        next_batch_at:    null,
        results:          dispatchError
          ? [{ error: dispatchError, partial: results }]
          : results,
      })
      .eq("id", id);
  } else {
    // Drip: more batches remain. Reset next_batch_at to now so the next
    // cron tick (5 min from now) will pick this row up immediately.
    await sb.from("admin_broadcasts")
      .update({
        status:           "sending",
        total_recipients: recipients.length,
        ok_count:         totalOk,
        fail_count:       totalFail,
        dispatched_count: newDispatched,
        next_batch_at:    new Date().toISOString(),
        results,
      })
      .eq("id", id);
  }

  processed.push({
    id,
    ok:        !dispatchError,
    total:     recipients.length,
    ok_count:  totalOk,
    fail_count: totalFail,
    dispatched: newDispatched,
    remaining:  Math.max(0, recipients.length - newDispatched),
    error:      dispatchError ?? undefined,
  });
}
