/**
 * Admin "Ver como" (impersonation) plumbing.
 *
 * Mechanism:
 *   - Admin hits POST /api/admin/impersonate/start { target_user_id }.
 *   - Server validates, writes an impersonation_log row, and sets an
 *     HTTP-only signed cookie `aa_impersonate` containing the target
 *     user id + role + admin id + an expiry (2h).
 *   - Role-scoped pages (/estudiante/*, /profesor/*, /aula/*) check this
 *     cookie via `getImpersonation()` and, if valid AND the real user is
 *     admin, treat the request as if the target user made it (data-wise).
 *   - A sticky banner (ImpersonationBanner) is rendered at the root layout
 *     so it's impossible to forget you're in someone else's account.
 *   - POST /api/admin/impersonate/stop closes the log row and clears the
 *     cookie.
 *
 * Why not modify the NextAuth JWT? We want the admin's session to stay
 * intact so they can hop back into /admin without re-logging in. Adding a
 * second cookie is the cleanest layering.
 */

import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "node:crypto";

export const IMPERSONATE_COOKIE = "aa_impersonate";
const IMPERSONATE_TTL_MS = 2 * 60 * 60 * 1000;   // 2h

type ImpersonatePayload = {
  admin_id:      string;
  admin_name:    string;
  target_id:     string;                                    // users.id
  target_role:   "teacher" | "student";
  target_name:   string;
  target_email:  string;
  exp:           number;                                    // epoch ms
};

// ---------------------------------------------------------------------------
// Signing — we don't store this cookie in Supabase; a short HMAC is enough.
// Key = NEXTAUTH_SECRET (already in the env). Do NOT fall back to a hardcoded
// dev key; if it's missing, refuse to sign.
// ---------------------------------------------------------------------------
function signingKey(): Buffer {
  const s = process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error("NEXTAUTH_SECRET missing — cannot sign impersonation cookie");
  return Buffer.from(s, "utf8");
}

function encode(payload: ImpersonatePayload): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig  = createHmac("sha256", signingKey()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function decode(raw: string): ImpersonatePayload | null {
  const [body, sig] = raw.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", signingKey()).update(body).digest("base64url");
  const a = Buffer.from(sig,      "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as ImpersonatePayload;
    if (Date.now() > p.exp) return null;
    return p;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Reads — call from server components / route handlers.
// ---------------------------------------------------------------------------
export async function getImpersonation(): Promise<ImpersonatePayload | null> {
  const jar = await cookies();
  const raw = jar.get(IMPERSONATE_COOKIE)?.value;
  if (!raw) return null;
  return decode(raw);
}

// ---------------------------------------------------------------------------
// Writes — only called from API routes (POST endpoints).
// ---------------------------------------------------------------------------
export async function setImpersonation(p: Omit<ImpersonatePayload, "exp">) {
  const payload: ImpersonatePayload = { ...p, exp: Date.now() + IMPERSONATE_TTL_MS };
  const jar = await cookies();
  jar.set(IMPERSONATE_COOKIE, encode(payload), {
    httpOnly: true,
    secure:   process.env.NODE_ENV === "production",
    sameSite: "lax",
    path:     "/",
    maxAge:   IMPERSONATE_TTL_MS / 1000,
  });
}

export async function clearImpersonation() {
  const jar = await cookies();
  jar.delete(IMPERSONATE_COOKIE);
}

// ---------------------------------------------------------------------------
// Helper for role-scoped pages. Returns the user_id the page should load
// data for, plus a flag the banner uses.
// ---------------------------------------------------------------------------
export async function resolveEffectiveUser(opts: {
  fallbackUserId: string;
  fallbackRole:   "superadmin" | "admin" | "teacher" | "student";
  expectRole?:    "teacher" | "student";   // refuse impersonation if role mismatches
}): Promise<{
  userId:       string;
  role:         "superadmin" | "admin" | "teacher" | "student";
  impersonated: { admin_id: string; admin_name: string } | null;
}> {
  const imp = await getImpersonation();

  // Only admins can impersonate; otherwise ignore the cookie.
  const canImpersonate = opts.fallbackRole === "admin" || opts.fallbackRole === "superadmin";
  if (!imp || !canImpersonate) {
    return { userId: opts.fallbackUserId, role: opts.fallbackRole, impersonated: null };
  }
  if (opts.expectRole && imp.target_role !== opts.expectRole) {
    return { userId: opts.fallbackUserId, role: opts.fallbackRole, impersonated: null };
  }

  return {
    userId:       imp.target_id,
    role:         imp.target_role,
    impersonated: { admin_id: imp.admin_id, admin_name: imp.admin_name },
  };
}
