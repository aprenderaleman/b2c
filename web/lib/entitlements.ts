/**
 * Cross-platform entitlements — b2c talks to Schule (and Hans soon)
 * server-to-server to give active students automatic access.
 *
 * Schule: full access (tier='active', ssoUser=1) for every student
 *   whose subscription is active and pack isn't expired.
 * Hans:   starter tier for the same cohort (coming soon).
 *
 * Shared secret is env.B2C_SYNC_SECRET — must match on both sides.
 */

type Email = string;

export type SchuleLinkResult = {
  ok:          true;
  ssoToken:    string;
  userId:      string;
  redirectUrl: string;
} | {
  ok:     false;
  error:  string;
  status: number;
};

const SCHULE_BASE = process.env.SCHULE_API_URL ?? "https://api-schule.aprender-aleman.de";
const HANS_BASE   = process.env.HANS_API_URL   ?? "https://hans-api.aprender-aleman.de/api";

/**
 * Server-side call to Schule to generate a one-shot SSO link. Returns
 * an HTTPS URL the client should redirect to — handled by Schule's
 * /auto-login page which verifies the token and logs the user in.
 *
 * Safe to call many times — Schule upserts the subscription every call,
 * so this doubles as the "sync entitlement" side effect.
 */
export async function createSchuleSsoLink(args: {
  email:    Email;
  fullName: string | null;
  phone:    string | null;
}): Promise<SchuleLinkResult> {
  const secret = process.env.B2C_SYNC_SECRET;
  if (!secret) {
    return { ok: false, error: "B2C_SYNC_SECRET not configured in b2c env", status: 503 };
  }

  const res = await fetch(`${SCHULE_BASE}/api/b2c/sso-link`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({
      email:     args.email,
      full_name: args.fullName ?? undefined,
      phone:     args.phone ?? undefined,
      secret,
    }),
    // Never cache — these tokens are short-lived.
    cache: "no-store",
  });

  if (!res.ok) {
    let msg = `schule returned ${res.status}`;
    try {
      const body = await res.json();
      if (body?.error) msg = body.error;
    } catch { /* ignore */ }
    return { ok: false, error: msg, status: res.status };
  }

  const data = await res.json() as {
    ssoToken: string; userId: string; redirectUrl: string;
  };
  return {
    ok:          true,
    ssoToken:    data.ssoToken,
    userId:      data.userId,
    redirectUrl: data.redirectUrl,
  };
}

/**
 * Server-side call to Hans backend to generate a one-shot SSO link.
 * Hans's response shape:
 *   { success: true, data: { redirectUrl: string, userId: number } }
 *
 * Calling this is idempotent: Hans upserts the user, flips
 * isAprendStudent=true, and guarantees a `starter` subscription.
 */
export async function createHansSsoLink(args: {
  email:    Email;
  fullName: string | null;
}): Promise<SchuleLinkResult> {
  const secret = process.env.B2C_SYNC_SECRET;
  if (!secret) {
    return { ok: false, error: "B2C_SYNC_SECRET not configured in b2c env", status: 503 };
  }

  const res = await fetch(`${HANS_BASE.replace(/\/$/, "")}/auth/b2c-sso-link`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({
      email:    args.email,
      fullName: args.fullName ?? undefined,
      secret,
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    let msg = `hans returned ${res.status}`;
    try {
      const body = await res.json();
      if (body?.message) msg = body.message;
      else if (body?.error) msg = body.error;
    } catch { /* ignore */ }
    return { ok: false, error: msg, status: res.status };
  }

  const body = await res.json() as {
    success: boolean; data?: { redirectUrl: string; userId: number };
  };
  if (!body.success || !body.data) {
    return { ok: false, error: "unexpected_hans_response", status: 502 };
  }
  return {
    ok:          true,
    ssoToken:    "",                                   // Hans embeds it in redirectUrl
    userId:      String(body.data.userId),
    redirectUrl: body.data.redirectUrl,
  };
}
