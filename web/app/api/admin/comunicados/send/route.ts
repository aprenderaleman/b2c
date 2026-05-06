import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/comunicados/auth";
import { sendBodySchema, SCHEDULE_MIN_LEAD_MS } from "@/lib/comunicados/schema";
import { resolveRecipients } from "@/lib/comunicados/audience";
import { dispatchSequentially, summariseResults, loadAttachments } from "@/lib/comunicados/send";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * POST /api/admin/comunicados/send
 *
 * Two modes, switched by the optional `scheduled_at`:
 *
 *   1. Immediate (default): re-resolves the audience server-side,
 *      iterates the recipients, fires email + whatsapp in parallel
 *      per-recipient, logs the whole attempt into admin_broadcasts
 *      with status='sent', and returns per-recipient results for UI
 *      feedback.
 *
 *   2. Scheduled (`scheduled_at` ≥ now + 5 min): inserts the row with
 *      status='queued' and DOES NOT send. The dispatch cron will pick
 *      it up at the scheduled time and re-resolve the audience THEN
 *      so newly-added users are included.
 *
 * The 5-min minimum lead time matches the dispatch cron interval — any
 * closer and the row risks missing its window.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const guard = await requireAdminApi();
  if (!guard.ok) return guard.res;

  const parsed = sendBodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  }
  const { audience_filter, subject, message_markdown, channels, attachments, scheduled_at } = parsed.data;

  // ---------- Branch: scheduled vs immediate ----------
  if (scheduled_at) {
    const when = new Date(scheduled_at).getTime();
    const now  = Date.now();
    if (when - now < SCHEDULE_MIN_LEAD_MS) {
      return NextResponse.json(
        { error: "scheduled_too_soon", min_lead_ms: SCHEDULE_MIN_LEAD_MS },
        { status: 400 },
      );
    }

    const sb = supabaseAdmin();
    const { data, error } = await sb
      .from("admin_broadcasts")
      .insert({
        admin_user_id:    guard.adminUserId,
        audience_filter,
        subject,
        message_markdown,
        channels,
        attachments,
        total_recipients: 0,
        ok_count:         0,
        fail_count:       0,
        results:          [],
        scheduled_at,
        status:           "queued",
      })
      .select("id")
      .single();

    if (error) {
      return NextResponse.json({ error: "db_error", message: error.message }, { status: 500 });
    }
    return NextResponse.json({
      ok:           true,
      queued:       true,
      broadcast_id: data?.id ?? null,
      scheduled_at,
    });
  }

  // ---------- Immediate send ----------
  const recipients        = await resolveRecipients(audience_filter);
  const loadedAttachments = await loadAttachments(attachments);

  // Sequential per-recipient with pacing — keeps us under Resend's 5 req/s.
  const results = await dispatchSequentially(
    recipients, subject, message_markdown, channels, loadedAttachments,
  );

  const { ok_count, fail_count } = summariseResults(results);

  // Log the broadcast. Failures here do NOT fail the user-facing response —
  // the emails/whatsapps already went out; the log is best-effort.
  let broadcastId: string | null = null;
  try {
    const sb = supabaseAdmin();
    const { data, error } = await sb
      .from("admin_broadcasts")
      .insert({
        admin_user_id:    guard.adminUserId,
        audience_filter,
        subject,
        message_markdown,
        channels,
        attachments,
        total_recipients: recipients.length,
        ok_count,
        fail_count,
        results,
        status:           "sent",
      })
      .select("id")
      .single();
    if (error) console.error("[comunicados/send] log insert failed:", error.message);
    broadcastId = data?.id ?? null;
  } catch (e) {
    console.error("[comunicados/send] log insert threw:", e);
  }

  return NextResponse.json({
    ok:               fail_count === 0,
    queued:           false,
    broadcast_id:     broadcastId,
    total_recipients: recipients.length,
    ok_count,
    fail_count,
    results,
  });
}
