import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/comunicados/auth";
import { sendBodySchema } from "@/lib/comunicados/schema";
import { resolveRecipients } from "@/lib/comunicados/audience";
import { sendToRecipient, summariseResults } from "@/lib/comunicados/send";
import { supabaseAdmin } from "@/lib/supabase";
import type { SendResultRow } from "@/lib/comunicados/types";

/**
 * POST /api/admin/comunicados/send
 *
 * Re-resolves the audience server-side (never trusts the client's
 * preview), iterates the recipients, fires email + whatsapp in parallel
 * per-recipient, logs the whole attempt into admin_broadcasts, and
 * returns per-recipient results for immediate UI feedback.
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
  const { audience_filter, subject, message_markdown, channels } = parsed.data;

  const recipients = await resolveRecipients(audience_filter);

  // Sequential per-recipient — protects Resend / the agents VPS and keeps
  // ordering deterministic. Channel sends inside sendToRecipient run in parallel.
  const results: SendResultRow[] = [];
  for (const r of recipients) {
    const row = await sendToRecipient(r, subject, message_markdown, channels);
    results.push(row);
  }

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
        total_recipients: recipients.length,
        ok_count,
        fail_count,
        results,
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
    broadcast_id:     broadcastId,
    total_recipients: recipients.length,
    ok_count,
    fail_count,
    results,
  });
}
