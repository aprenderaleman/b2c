import { Resend } from "resend";
import nodemailer, { type Transporter } from "nodemailer";

/**
 * Email senders used by lib/email/send.ts.
 *
 * Two backends are supported — whichever is configured wins, Resend
 * takes precedence if both are set. If neither is configured the
 * caller logs the email to console and returns ok=true so local/dev
 * doesn't break.
 *
 *   (1) Resend         — set RESEND_API_KEY
 *   (2) SMTP (Hostinger, Gmail, anything) — set SMTP_HOST, SMTP_USER,
 *                        SMTP_PASS, optional SMTP_PORT (default 465),
 *                        optional SMTP_SECURE ("true"/"false",
 *                        default "true" for port 465, "false" else).
 *
 * The project used to be Resend-only; SMTP was added because the
 * production Resend key wasn't provisioned and Hostinger SMTP was
 * already available on the domain.
 */

// ---------------------------------------------------------------------------
// Resend — kept for parity with the previous setup / as a fallback option.
// ---------------------------------------------------------------------------
let _resend: Resend | null = null;
let _resendChecked = false;

export function getResend(): Resend | null {
  if (_resendChecked) return _resend;
  _resendChecked = true;
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  _resend = new Resend(key);
  return _resend;
}

// ---------------------------------------------------------------------------
// SMTP — nodemailer transporter, lazily constructed. One transporter per
// process because connections pool nicely.
// ---------------------------------------------------------------------------
let _smtp: Transporter | null = null;
let _smtpChecked = false;

export function getSmtp(): Transporter | null {
  if (_smtpChecked) return _smtp;
  _smtpChecked = true;
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;
  const port = Number(process.env.SMTP_PORT ?? 465);
  const secureEnv = process.env.SMTP_SECURE;
  const secure = secureEnv ? secureEnv === "true" : port === 465;
  // Modest timeout caps so a wedged SMTP doesn't pin a Vercel
  // function for 10 minutes (nodemailer's default socket timeout),
  // but generous enough to ride out a normal Hostinger handshake
  // without aborting on the first slow packet.
  _smtp = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    connectionTimeout: 30_000,  // 30s for the TCP+TLS handshake
    greetingTimeout:   20_000,  // 20s for the initial 220 banner
    socketTimeout:     60_000,  // 60s for the whole conversation
    pool:              true,    // reuse connections across calls
    maxConnections:    3,
  });
  return _smtp;
}

export function emailBackendConfigured(): "resend" | "smtp" | null {
  if (process.env.RESEND_API_KEY)                                        return "resend";
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) return "smtp";
  return null;
}

// ---------------------------------------------------------------------------
// Shared: the From address. Must match a verified sender / domain on
// whichever backend is in use.
// ---------------------------------------------------------------------------
export function fromAddress(): string {
  return (
    process.env.EMAIL_FROM ??
    "Aprender-Aleman.de <info@aprender-aleman.de>"
  );
}
