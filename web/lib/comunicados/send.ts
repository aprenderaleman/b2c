import { sendRaw } from "@/lib/email/send";
import { sendWhatsappText } from "@/lib/whatsapp";
import { renderBroadcast, renderWhatsappOnly } from "./render";
import type { Channel, Recipient, SendResultRow } from "./types";

/**
 * Send a broadcast message to one recipient across the selected channels.
 * Email + WhatsApp run in parallel per recipient; the outer loop (in the
 * API route) sequences recipients so we don't batter Resend or the
 * agents VPS with dozens of simultaneous connections.
 */
export async function sendToRecipient(
  r:        Recipient,
  subject:  string,
  markdown: string,
  channels: Channel[],
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
      sendRaw(r.email!, s, html, text)
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
