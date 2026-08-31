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

/**
 * Regla única de elegibilidad de pack (caso Victoria 2026-08-07):
 * un estudiante con clases restantes NUNCA pierde acceso a
 * Schule/Hans aunque pack_expires_at haya pasado — esa fecha queda
 * obsoleta en legacy/repras (Javier compró 48 clases y su fecha
 * seguía en julio). La fecha solo bloquea cuando además no quedan
 * clases.
 */
export function packEligible(s: {
  subscription_status: string | null;
  pack_expires_at:     string | null;
  classes_remaining:   number | null;
}): boolean {
  const statusOk = s.subscription_status === "active" || s.subscription_status === "paused";
  if (!statusOk) return false;
  const expired = s.pack_expires_at ? new Date(s.pack_expires_at) < new Date() : false;
  if (!expired) return true;
  return (s.classes_remaining ?? 0) > 0;
}

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
// Hans backend lives at hans.aprender-aleman.de/api (no separate API
// subdomain) — el subdominio `hans-api.aprender-aleman.de` que el
// default antiguo apuntaba NO resuelve (DNS muerto). Caso Alejandra
// 02/06: clicó el botón, Hans devolvió "Could not resolve host".
const HANS_BASE   = process.env.HANS_API_URL   ?? "https://hans.aprender-aleman.de/api";

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
  /**
   * Rol con el que Schule debe crear/actualizar al usuario. Sin él,
   * Schule crea 'schule_student' (comportamiento histórico — los
   * alumnos siguen sin mandarlo). "teacher"/"admin" hacen que profes
   * y admins entren con SSO como ellos mismos en vez de caer en el
   * formulario de login (caso Jonathan 2026-08-28).
   */
  role?:    "teacher" | "admin";
}): Promise<SchuleLinkResult> {
  const secret = process.env.B2C_SYNC_SECRET;
  if (!secret) {
    return { ok: false, error: "B2C_SYNC_SECRET not configured in b2c env", status: 503 };
  }

  // Caso Alejandra 02/06: alumna con teléfono +52 (México). Schule
  // devolvía 500 "Error interno del servidor" al hacer el upsert,
  // probablemente por su validador de teléfono regional (los demás
  // alumnos tienen +34/+41/+49). Patrón: intentamos con teléfono
  // primero (sigue siendo útil para sync) y, si Schule rechaza con
  // ≥500, reintentamos sin teléfono — la SSO no depende del número
  // y la alumna debe poder entrar.
  const tryRequest = async (includePhone: boolean) => {
    const body: Record<string, unknown> = { email: args.email, secret };
    if (args.fullName) body.full_name = args.fullName;
    if (args.role)     body.role      = args.role;
    if (includePhone && args.phone) body.phone = args.phone;
    return fetch(`${SCHULE_BASE}/api/b2c/sso-link`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(body),
      cache:   "no-store",
    });
  };

  let res = await tryRequest(true);

  if (!res.ok && res.status >= 500 && args.phone) {
    console.warn(
      `[schule-sso] retry sin teléfono — primera respuesta ${res.status} para ${args.email}`,
    );
    res = await tryRequest(false);
  }

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
