/**
 * One-click email-action tokens.
 *
 * Used by the CONFIRMAR / CAMBIAR buttons inside trial emails. The
 * payload identifies the lead + class + action; the email link points
 * at /api/email-action/{action}?t=<token>. Single signing scheme so we
 * can rotate by bumping NEXTAUTH_SECRET if needed.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export type EmailActionType = "confirm" | "reschedule";

export type EmailActionPayload = {
  lead_id:  string;
  class_id: string;
  action:   EmailActionType;
  exp:      number;
};

const TTL_MS = 30 * 24 * 3600_000;

function key(): Buffer {
  const s = process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error("NEXTAUTH_SECRET missing — cannot sign email-action token");
  return Buffer.from(s, "utf8");
}

function encode(p: EmailActionPayload): string {
  const body = Buffer.from(JSON.stringify(p), "utf8").toString("base64url");
  const sig  = createHmac("sha256", key()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function buildEmailActionToken(
  leadId: string,
  classId: string,
  action: EmailActionType,
): string {
  return encode({ lead_id: leadId, class_id: classId, action, exp: Date.now() + TTL_MS });
}

export function verifyEmailActionToken(raw: string): EmailActionPayload | null {
  const [body, sig] = raw.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", key()).update(body).digest("base64url");
  const a = Buffer.from(sig, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as EmailActionPayload;
    if (Date.now() > p.exp) return null;
    if (p.action !== "confirm" && p.action !== "reschedule") return null;
    return p;
  } catch {
    return null;
  }
}

export function buildEmailActionUrl(opts: {
  leadId:  string;
  classId: string;
  action:  EmailActionType;
  baseUrl?: string;
}): string {
  const base = (opts.baseUrl ?? process.env.PLATFORM_URL ?? "https://b2c.aprender-aleman.de")
    .replace(/\/$/, "");
  const t = buildEmailActionToken(opts.leadId, opts.classId, opts.action);
  return `${base}/api/email-action/${opts.action}?t=${encodeURIComponent(t)}`;
}
