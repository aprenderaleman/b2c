import { Resend } from "resend";

/**
 * Resend client singleton. Must only be imported from server code.
 * If RESEND_API_KEY isn't set (local dev without email, CI, etc.) we
 * return null and callers should gracefully log the intended email
 * instead of sending.
 */
let _resend: Resend | null = null;
let _checked = false;

export function getResend(): Resend | null {
  if (_checked) return _resend;
  _checked = true;
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn("[email] RESEND_API_KEY is not set — emails will be logged only.");
    return null;
  }
  _resend = new Resend(key);
  return _resend;
}

/**
 * Address we send FROM. Must match a verified sender / domain on Resend.
 * Configured via env (EMAIL_FROM) so we don't hardcode branding.
 */
export function fromAddress(): string {
  return (
    process.env.EMAIL_FROM ??
    "Aprender-Aleman.de <info@aprender-aleman.de>"
  );
}
