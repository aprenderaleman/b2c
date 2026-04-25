/**
 * Magic-link token + cookie for trial-class leads.
 *
 * A lead who books a trial doesn't have a user account yet (per
 * Gelfis: account is created only when they pay). To let them join
 * the live aula on the day of the trial, the booking email contains
 * a signed link `/trial/{class_id}?t={token}` which:
 *
 *   1. validates the HMAC against NEXTAUTH_SECRET
 *   2. checks the lead_id matches the class.lead_id
 *   3. sets an HTTP-only cookie `aa_trial_session` scoped to that
 *      single class for 7 days
 *   4. redirects to /aula/{class_id}
 *
 * The aula auth check (lib/aula.ts) recognises the cookie and lets
 * the lead in as a "lead participant" — no user row required.
 */

import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "node:crypto";

export const TRIAL_COOKIE = "aa_trial_session";
const TRIAL_TTL_MS = 7 * 24 * 3600_000;             // 7 days

export type TrialPayload = {
  lead_id:  string;
  class_id: string;
  exp:      number;                                 // epoch ms
};

function signingKey(): Buffer {
  const s = process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error("NEXTAUTH_SECRET missing — cannot sign trial token");
  return Buffer.from(s, "utf8");
}

function encode(payload: TrialPayload): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig  = createHmac("sha256", signingKey()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function decode(raw: string): TrialPayload | null {
  const [body, sig] = raw.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", signingKey()).update(body).digest("base64url");
  const a = Buffer.from(sig, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as TrialPayload;
    if (Date.now() > p.exp) return null;
    return p;
  } catch {
    return null;
  }
}

/** Build the signed token used in the email link (no cookie touched). */
export function buildTrialToken(leadId: string, classId: string): string {
  return encode({
    lead_id:  leadId,
    class_id: classId,
    exp:      Date.now() + TRIAL_TTL_MS,
  });
}

export function verifyTrialToken(raw: string): TrialPayload | null {
  return decode(raw);
}

/** Set the cookie after a successful magic-link verification. */
export async function setTrialSession(payload: TrialPayload) {
  const jar = await cookies();
  jar.set(TRIAL_COOKIE, encode(payload), {
    httpOnly: true,
    secure:   process.env.NODE_ENV === "production",
    sameSite: "lax",
    path:     "/",
    maxAge:   Math.max(60, Math.floor((payload.exp - Date.now()) / 1000)),
  });
}

/** Read + validate the cookie on each aula request. */
export async function getTrialSession(): Promise<TrialPayload | null> {
  const jar = await cookies();
  const raw = jar.get(TRIAL_COOKIE)?.value;
  if (!raw) return null;
  return decode(raw);
}

export async function clearTrialSession() {
  const jar = await cookies();
  jar.delete(TRIAL_COOKIE);
}
