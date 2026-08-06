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

// Branded type — un `LeadJoinUrl` solo se obtiene llamando a
// `buildLeadJoinUrl()`. Los emails/WhatsApp del lead aceptan ESTE
// tipo, no un `string` cualquiera. Si alguien escribe nuevo código
// que pasa un URL bare `/aula/{id}` al template del lead, TypeScript
// falla en compile-time. Garantía estructural contra el bug que
// reapareció dos veces (2026-05-11) por escribir URLs a mano.
declare const __leadJoinUrlBrand: unique symbol;
export type LeadJoinUrl = string & { readonly [__leadJoinUrlBrand]: true };

/**
 * Construye el URL que damos al LEAD para que entre al aula sin login.
 *
 * SIEMPRE usa el shortcode (`/c/{code}`) — se lee bien en WhatsApp.
 * A partir de migración 102 (2026-08-06), `classes.short_code` es
 * NOT NULL con default vía trigger `classes_ensure_short_code_trg`,
 * así que en producción SIEMPRE hay shortCode.
 *
 * Fallback al URL signed largo `/trial/{id}?t={token}` ELIMINADO:
 * causaba mensajes feos (~200 chars). Si un caller pasa shortCode
 * null/vacío indica bug de datos — logueamos error y usamos el fallback
 * largo SOLO como último recurso para no romper al lead. En producción
 * este path no debería tomarse jamás.
 *
 * ÚNICA forma soportada de obtener un LeadJoinUrl. NO hagas cast
 * desde string — eso burla la garantía de tipos y rompemos a los
 * leads otra vez.
 */
export function buildLeadJoinUrl(opts: {
  classId:    string;
  leadId:     string;
  shortCode?: string | null;
  baseUrl?:   string;
}): LeadJoinUrl {
  const base = (opts.baseUrl ?? process.env.PLATFORM_URL ?? "https://b2c.aprender-aleman.de")
    .replace(/\/$/, "");
  if (opts.shortCode && opts.shortCode.length > 0) {
    return `${base}/c/${opts.shortCode}` as LeadJoinUrl;
  }
  // Guard rail: no debería pasar tras migración 102. Log alto + fallback
  // al URL largo para no dejar al lead sin acceso al aula.
  console.error(
    `[buildLeadJoinUrl] short_code missing for class ${opts.classId} — ` +
    `usando fallback URL largo. Investigar por qué el trigger BD no lo generó.`,
  );
  const token = encodeURIComponent(buildTrialToken(opts.leadId, opts.classId));
  return `${base}/trial/${opts.classId}?t=${token}` as LeadJoinUrl;
}

/**
 * Runtime guard adicional. Llama desde los wrappers de email/WhatsApp
 * que reciben joinUrl: string (no se puede tipar a LeadJoinUrl por
 * compat con otros callers). Lanza si detecta el patrón bare.
 */
export function assertLeadJoinUrl(url: string, context: string): void {
  if (/\/aula\/[a-f0-9-]+(?:\b|$)/i.test(url) && !url.includes("?t=") && !url.includes("/c/")) {
    throw new Error(
      `[${context}] El URL para el lead es bare /aula/{id} — bouncea a /login. ` +
      `Usa buildLeadJoinUrl(). URL recibido: ${url.slice(0, 120)}`,
    );
  }
}

/**
 * URL para clases de prueba (is_trial=true) destinado a CUALQUIER
 * recipient (profesor, lead, admin). SIEMPRE `/c/{short_code}` — tras
 * migración 102 short_code es NOT NULL con default vía trigger.
 *
 * Si por bug de datos falta short_code, log de error + fallback a
 * `/aula/{id}` (el profe autenticado igual entra; el lead necesitaría
 * el URL largo con token, pero ese caso lo cubre buildLeadJoinUrl).
 */
export function buildTrialClassUrl(opts: {
  classId:    string;
  shortCode:  string | null | undefined;
  baseUrl?:   string;
}): string {
  const base = (opts.baseUrl ?? process.env.PLATFORM_URL ?? "https://b2c.aprender-aleman.de")
    .replace(/\/$/, "");
  if (opts.shortCode && opts.shortCode.length > 0) {
    return `${base}/c/${opts.shortCode}`;
  }
  console.error(
    `[buildTrialClassUrl] short_code missing for class ${opts.classId} — ` +
    `usando fallback /aula/{id}. Investigar por qué el trigger BD no lo generó.`,
  );
  return `${base}/aula/${opts.classId}`;
}
