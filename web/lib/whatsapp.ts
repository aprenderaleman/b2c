/**
 * WhatsApp bridge — sends one-off messages (welcome, notifications) by
 * POST-ing to the internal endpoint that lives on the agents VPS
 * (webhook_server.py). The agents VPS is the only host that can talk to
 * Evolution API, so this keeps the bridge out of Vercel's attack surface.
 *
 * Env:
 *   AGENTS_BASE_URL        e.g. https://agents.aprender-aleman.de
 *   AGENTS_INTERNAL_SECRET shared secret, must match AGENTS_INTERNAL_SECRET
 *                          on the Python side.
 *
 * Behaves gracefully if the env is missing: returns ok=false with a
 * clear reason so callers can log the intent and move on.
 */

export type WhatsappResult =
  | { ok: true;  messageId: string | null }
  | { ok: false; reason: string };

/**
 * Send a plain-text WhatsApp message to a phone number in E.164 format.
 * Caller is responsible for ensuring the number is valid & opted-in.
 */
export async function sendWhatsappText(
  phoneE164: string,
  text: string,
): Promise<WhatsappResult> {
  const baseUrl = process.env.AGENTS_BASE_URL?.replace(/\/$/, "");
  const secret  = process.env.AGENTS_INTERNAL_SECRET;
  if (!baseUrl || !secret) {
    console.warn(
      "[whatsapp] AGENTS_BASE_URL / AGENTS_INTERNAL_SECRET missing — " +
      "message not sent. Would have sent to %s: %s",
      phoneE164,
      text.slice(0, 120),
    );
    return { ok: false, reason: "missing_agent_env" };
  }

  try {
    const res = await fetch(`${baseUrl}/internal/send-text`, {
      method: "POST",
      headers: {
        "Content-Type":        "application/json",
        "X-Internal-Secret":   secret,
      },
      body: JSON.stringify({ phone: phoneE164, text }),
      // 60s ceiling — long enough that a slow Evolution API call
      // doesn't cause a false-negative `send_failed` timeline log
      // when the message actually delivered. The caller's response
      // path no longer waits on this (book-trial uses `after()`),
      // so there's no UX pressure to fail fast.
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, reason: `http_${res.status}:${body.slice(0, 200)}` };
    }
    const data = (await res.json().catch(() => ({}))) as { messageId?: string };
    return { ok: true, messageId: data.messageId ?? null };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "unknown" };
  }
}
