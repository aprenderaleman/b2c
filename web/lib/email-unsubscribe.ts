/**
 * Enlaces de baja para emails comerciales (campañas de reactivación).
 *
 * Token = HMAC(NEXTAUTH_SECRET) del lead_id, sin caducidad: un enlace de
 * baja tiene que seguir funcionando meses después. La baja se guarda en
 * leads.email_status = "unsubscribed" y solo bloquea envíos `marketing`
 * (sendRaw opts.marketing) — confirmaciones y recordatorios de una clase
 * que el lead reserve siguen saliendo.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

function sign(leadId: string): string {
  const s = process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error("NEXTAUTH_SECRET missing — cannot sign unsubscribe token");
  return createHmac("sha256", s).update(`unsub:${leadId}`).digest("base64url").slice(0, 32);
}

export function buildUnsubscribeToken(leadId: string): string {
  return `${leadId}.${sign(leadId)}`;
}

export function verifyUnsubscribeToken(raw: string): string | null {
  const [leadId, sig] = raw.split(".");
  if (!leadId || !sig) return null;
  const a = Buffer.from(sig, "utf8");
  const b = Buffer.from(sign(leadId), "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return leadId;
}

export function buildUnsubscribeUrl(leadId: string, baseUrl?: string): string {
  const base = (baseUrl ?? process.env.PLATFORM_URL ?? "https://b2c.aprender-aleman.de").replace(/\/$/, "");
  return `${base}/api/email-action/unsubscribe?t=${encodeURIComponent(buildUnsubscribeToken(leadId))}`;
}

/** Cabeceras RFC 8058 (baja con un clic en Gmail / Outlook / Apple Mail). */
export function unsubscribeHeaders(leadId: string, baseUrl?: string): Record<string, string> {
  return {
    "List-Unsubscribe":      `<${buildUnsubscribeUrl(leadId, baseUrl)}>, <mailto:info@aprender-aleman.de?subject=baja>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}
