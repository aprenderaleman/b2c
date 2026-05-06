import { sendRaw, type EmailAttachment } from "@/lib/email/send";
import { sendWhatsappText } from "@/lib/whatsapp";
import { supabaseAdmin } from "@/lib/supabase";
import { renderBroadcast, renderWhatsappOnly } from "./render";
import type { Attachment, Channel, Recipient, SendResultRow } from "./types";

/**
 * Resend's free / default tier caps requests at 5 req/s per API key.
 * `sendToRecipient` issues at most one Resend call (the email one), so
 * pacing the OUTER loop at ≥ 250 ms guarantees we stay at 4 req/s with
 * comfortable headroom — even when WhatsApp is also enabled (those go
 * to a different host and don't share the budget).
 *
 * The pacing is a no-op for recipients that don't trigger an email
 * (whatsapp-only sends), but the cost of an extra ~250 ms in those
 * cases is negligible vs. the simplicity of one knob covering both.
 */
export const SEND_PACING_MS = 250;

/** Promise-based sleep used between recipient iterations to pace sends. */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Drive a sequential per-recipient send while pacing iterations to
 * stay under provider rate limits. The first recipient fires
 * immediately; every subsequent one waits SEND_PACING_MS after the
 * previous one finished.
 *
 * Both /api/admin/comunicados/send and the dispatch cron use this so
 * pacing rules live in exactly one place.
 */
export async function dispatchSequentially(
  recipients:  Recipient[],
  subject:     string,
  markdown:    string,
  channels:    Channel[],
  attachments: EmailAttachment[],
): Promise<SendResultRow[]> {
  const out: SendResultRow[] = [];
  for (let i = 0; i < recipients.length; i++) {
    if (i > 0) await sleep(SEND_PACING_MS);
    const row = await sendToRecipient(recipients[i], subject, markdown, channels, attachments);
    out.push(row);
  }
  return out;
}

/**
 * Download every attachment referenced by a broadcast row from the
 * `materials` Supabase bucket and return them as ready-to-send Buffers.
 *
 * We do this ONCE per send (not per recipient) — the bytes are
 * identical for everyone and Supabase Storage is the network bottleneck.
 *
 * Failures are not fatal: if a single file can't be downloaded we log
 * and skip it. The send still goes through with whatever loaded.
 */
export async function loadAttachments(refs: Attachment[]): Promise<EmailAttachment[]> {
  if (!refs || refs.length === 0) return [];
  const sb  = supabaseAdmin();
  const out: EmailAttachment[] = [];
  for (const ref of refs) {
    try {
      const { data, error } = await sb.storage.from("materials").download(ref.path);
      if (error || !data) {
        console.error("[comunicados] attachment download failed:", ref.path, error?.message);
        continue;
      }
      const buf = Buffer.from(await data.arrayBuffer());
      out.push({ filename: ref.name, content: buf, contentType: ref.content_type });
    } catch (e) {
      console.error("[comunicados] attachment threw:", ref.path, e);
    }
  }
  return out;
}

/**
 * Send a broadcast message to one recipient across the selected channels.
 * Email + WhatsApp run in parallel per recipient; the outer loop (in the
 * API route) sequences recipients so we don't batter Resend or the
 * agents VPS with dozens of simultaneous connections.
 *
 * `attachments` is email-only — WhatsApp ignores them. Pass the result of
 * loadAttachments() here so we don't re-download per recipient.
 */
export async function sendToRecipient(
  r:        Recipient,
  subject:  string,
  markdown: string,
  channels: Channel[],
  attachments: EmailAttachment[] = [],
): Promise<SendResultRow> {
  const wantEmail    = channels.includes("email")    && r.channels_available.includes("email")    && !!r.email;
  const wantWhatsapp = channels.includes("whatsapp") && r.channels_available.includes("whatsapp") && !!r.phone;

  const row: SendResultRow = {
    user_id: r.user_id,
    name:    r.name,
    email:   r.email,
    phone:   r.phone,
    email_r:    null,
    whatsapp_r: null,
  };

  const jobs: Promise<void>[] = [];

  if (wantEmail) {
    const { subject: s, html, text } = renderBroadcast(subject, markdown, r.name);
    jobs.push(
      sendRaw(r.email!, s, html, text, attachments.length > 0 ? attachments : undefined)
        .then(res => {
          row.email_r = res.ok
            ? { ok: true,  id: res.id, error: null }
            : { ok: false, id: null,   error: res.error };
        })
        .catch(e => {
          row.email_r = { ok: false, id: null, error: e instanceof Error ? e.message : "unknown" };
        }),
    );
  }

  if (wantWhatsapp) {
    const text = renderWhatsappOnly(markdown, r.name);
    jobs.push(
      sendWhatsappText(r.phone!, text)
        .then(res => {
          row.whatsapp_r = res.ok
            ? { ok: true,  id: res.messageId, error: null }
            : { ok: false, id: null,          error: res.reason };
        })
        .catch(e => {
          row.whatsapp_r = { ok: false, id: null, error: e instanceof Error ? e.message : "unknown" };
        }),
    );
  }

  await Promise.all(jobs);
  return row;
}

/**
 * Aggregate per-recipient rows into the totals we persist/return.
 * A recipient counts as "ok" iff every attempted channel succeeded.
 */
export function summariseResults(rows: SendResultRow[]): {
  ok_count: number;
  fail_count: number;
} {
  let ok = 0;
  let fail = 0;
  for (const r of rows) {
    const attempts = [r.email_r, r.whatsapp_r].filter(Boolean) as NonNullable<SendResultRow["email_r"]>[];
    if (attempts.length === 0) { fail++; continue; }  // nothing attempted = no channel available
    if (attempts.every(a => a.ok)) ok++;
    else fail++;
  }
  return { ok_count: ok, fail_count: fail };
}
