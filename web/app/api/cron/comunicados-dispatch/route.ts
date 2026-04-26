import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolveRecipients } from "@/lib/comunicados/audience";
import { sendToRecipient, summariseResults } from "@/lib/comunicados/send";
import { audienceFilterSchema } from "@/lib/comunicados/schema";
import type { AudienceFilter, Channel, SendResultRow } from "@/lib/comunicados/types";

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

  // 1. Find any due rows. We only need ids here — the claim step below
  //    re-reads the full row atomically.
  const { data: due, error: findErr } = await sb
    .from("admin_broadcasts")
    .select("id")
    .eq("status", "queued")
    .lte("scheduled_at", new Date().toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(MAX_ROWS_PER_TICK);

  if (findErr) {
    return NextResponse.json({ error: "db_error", message: findErr.message }, { status: 500 });
  }

  const processed: Array<{ id: string; ok: boolean; total: number; ok_count: number; fail_count: number; error?: string }> = [];

  for (const { id } of due ?? []) {
    // 2. Atomically claim — flip status from queued to sending. If a
    //    parallel invocation already grabbed it, the .eq filter prevents
    //    a second claim and we skip silently.
    const { data: claimed, error: claimErr } = await sb
      .from("admin_broadcasts")
      .update({ status: "sending" })
      .eq("id", id)
      .eq("status", "queued")
      .select("id, audience_filter, subject, message_markdown, channels")
      .maybeSingle();
    if (claimErr) {
      processed.push({ id, ok: false, total: 0, ok_count: 0, fail_count: 0, error: `claim:${claimErr.message}` });
      continue;
    }
    if (!claimed) {
      // Someone else got it.
      continue;
    }

    // 3. Validate the persisted filter shape — defensive, in case the row
    //    was inserted by hand. If invalid, mark failed so it doesn't
    //    re-loop on every cron tick.
    const filterParsed = audienceFilterSchema.safeParse(claimed.audience_filter);
    if (!filterParsed.success) {
      await sb
        .from("admin_broadcasts")
        .update({ status: "failed", results: [{ error: "invalid_audience_filter" }] })
        .eq("id", id);
      processed.push({ id, ok: false, total: 0, ok_count: 0, fail_count: 0, error: "invalid_audience_filter" });
      continue;
    }
    const filter:   AudienceFilter = filterParsed.data;
    const channels: Channel[]      = (claimed.channels ?? []).filter((c: string): c is Channel => c === "email" || c === "whatsapp");

    // 4. Resolve fresh + send sequentially (per-recipient) so the agents
    //    VPS / Resend aren't hammered.
    let results: SendResultRow[] = [];
    let dispatchError: string | null = null;
    try {
      const recipients = await resolveRecipients(filter);
      for (const r of recipients) {
        const row = await sendToRecipient(r, claimed.subject, claimed.message_markdown, channels);
        results.push(row);
      }
    } catch (e) {
      dispatchError = e instanceof Error ? e.message : "unknown";
    }

    const { ok_count, fail_count } = summariseResults(results);
    const final = dispatchError ? "failed" : (fail_count === 0 ? "sent" : "sent");
    // ↑ We mark status='sent' even if some recipients failed — failures
    //   are per-recipient and visible in `results`. 'failed' is reserved
    //   for "couldn't even attempt the send" (e.g. invalid filter, throw).

    await sb
      .from("admin_broadcasts")
      .update({
        status:           final,
        total_recipients: results.length,
        ok_count,
        fail_count,
        results: dispatchError
          ? [{ error: dispatchError, partial: results }]
          : results,
      })
      .eq("id", id);

    processed.push({
      id,
      ok: !dispatchError,
      total: results.length,
      ok_count,
      fail_count,
      error: dispatchError ?? undefined,
    });
  }

  return NextResponse.json({
    ok: true,
    processed,
    found: (due ?? []).length,
  });
}
