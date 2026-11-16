/**
 * email-typo-check — Gelfis 2026-11-16
 *
 * Detecta los typos más comunes de dominios de email ("outlook.comm",
 * "gmai.com", "yahho.es"…) y sugiere la corrección.
 *
 * Cubre los dominios de mayor volumen en nuestro funnel:
 *   gmail.com, hotmail.com/.es, outlook.com/.es, yahoo.com/.es,
 *   web.de, gmx.de/.es, icloud.com, live.com, aol.com, mail.com.
 *
 * Uso típico:
 *   const t = checkEmailTypo("juan@outlook.comm");
 *   if (t) → t.suggestion === "juan@outlook.com"
 */

const KNOWN_DOMAINS = new Set([
  "gmail.com", "googlemail.com",
  "hotmail.com", "hotmail.es", "hotmail.de", "hotmail.fr",
  "outlook.com", "outlook.es", "outlook.de",
  "yahoo.com", "yahoo.es", "yahoo.de",
  "web.de", "gmx.de", "gmx.com", "gmx.es", "gmx.net",
  "icloud.com", "me.com", "mac.com",
  "live.com", "msn.com",
  "aol.com", "mail.com", "t-online.de",
  "protonmail.com", "proton.me", "zoho.com",
]);

// Mapeo directo de typos conocidos → dominio correcto.
// Más eficaz que distance edit para casos de 1-2 caracteres cambiados.
const TYPO_MAP: Record<string, string> = {
  // gmail
  "gmail.co":   "gmail.com",
  "gmail.cm":   "gmail.com",
  "gmail.con":  "gmail.com",
  "gmail.cmo":  "gmail.com",
  "gmail.comm": "gmail.com",
  "gmail.coom": "gmail.com",
  "gmail.om":   "gmail.com",
  "gmai.com":   "gmail.com",
  "gmil.com":   "gmail.com",
  "gnail.com":  "gmail.com",
  "gmaail.com": "gmail.com",
  "gmall.com":  "gmail.com",
  "gmeil.com":  "gmail.com",
  "gmial.com":  "gmail.com",
  "gmaol.com":  "gmail.com",
  "gmails.com": "gmail.com",
  // outlook
  "outlook.co":   "outlook.com",
  "outlook.cm":   "outlook.com",
  "outlook.con":  "outlook.com",
  "outlook.cmo":  "outlook.com",
  "outlook.comm": "outlook.com",
  "outlook.coom": "outlook.com",
  "outlook.om":   "outlook.com",
  "outlok.com":   "outlook.com",
  "otlook.com":   "outlook.com",
  "outloook.com": "outlook.com",
  "outlookk.com": "outlook.com",
  "outllook.com": "outlook.com",
  "oulook.com":   "outlook.com",
  "outloo.com":   "outlook.com",
  // outlook.es
  "outlook.e":    "outlook.es",
  "outlook.ess":  "outlook.es",
  "outlok.es":    "outlook.es",
  "outloook.es":  "outlook.es",
  // hotmail
  "hotmail.co":   "hotmail.com",
  "hotmail.con":  "hotmail.com",
  "hotmail.cmo":  "hotmail.com",
  "hotmail.comm": "hotmail.com",
  "hotmail.coom": "hotmail.com",
  "hotmail.om":   "hotmail.com",
  "hotnail.com":  "hotmail.com",
  "hotmil.com":   "hotmail.com",
  "hotamil.com":  "hotmail.com",
  "hotmai.com":   "hotmail.com",
  "hotmaill.com": "hotmail.com",
  "hotmaik.com":  "hotmail.com",
  "hitmail.com":  "hotmail.com",
  "hotmail.e":    "hotmail.es",
  "hotmail.ess":  "hotmail.es",
  "hotamil.es":   "hotmail.es",
  "hotmail.de":   "hotmail.de", // válido
  // yahoo
  "yahoo.co":    "yahoo.com",
  "yahoo.con":   "yahoo.com",
  "yahoo.cmo":   "yahoo.com",
  "yahoo.comm":  "yahoo.com",
  "yahoo.coom":  "yahoo.com",
  "yahoo.om":    "yahoo.com",
  "yaho.com":    "yahoo.com",
  "yahho.com":   "yahoo.com",
  "yaho.es":     "yahoo.es",
  "yahho.es":    "yahoo.es",
  "yahooo.com":  "yahoo.com",
  "yahooo.es":   "yahoo.es",
  // web.de
  "web.d":       "web.de",
  "wed.de":      "web.de",
  "web.dee":     "web.de",
  "web.com":     "web.de",   // probable typo: deberían decir .de
  // gmx
  "gmx.d":       "gmx.de",
  "gmx.dee":     "gmx.de",
  "gmx.cm":      "gmx.com",
  "gmx.con":     "gmx.com",
  // icloud
  "icloud.co":   "icloud.com",
  "icloud.con":  "icloud.com",
  "icloud.comm": "icloud.com",
  "iclould.com": "icloud.com",
  "icloud.om":   "icloud.com",
  // live
  "live.co":   "live.com",
  "live.con":  "live.com",
  "live.cmo":  "live.com",
  "live.comm": "live.com",
};

// TLDs completamente inválidos que son typos puros (nunca son TLDs reales
// para un email personal). Si el dominio TERMINA en esto, es typo seguro.
const INVALID_TLD_ENDINGS = [
  ".comm", ".cmo", ".con", ".coom", ".cmn", ".vom",
  ".neet", ".orgg", ".de.de", ".com.com", ".es.es",
  ".cm", ".om", // sospechoso (podría ser Camerun/Omán pero es raro en email personal)
];

export type EmailTypoCheck =
  | { ok: true }
  | { ok: false; reason: string; suggestion?: string };

function splitEmail(email: string): { local: string; domain: string } | null {
  const trimmed = email.trim().toLowerCase();
  const atIdx = trimmed.lastIndexOf("@");
  if (atIdx <= 0 || atIdx === trimmed.length - 1) return null;
  return { local: trimmed.slice(0, atIdx), domain: trimmed.slice(atIdx + 1) };
}

/**
 * Chequea el email. Devuelve null si está OK, o { reason, suggestion }
 * si detecta typo.
 */
export function checkEmailTypo(email: string): EmailTypoCheck {
  const parts = splitEmail(email);
  if (!parts) return { ok: false, reason: "formato_invalido" };
  const { local, domain } = parts;

  // Doble @ o doble punto final
  if (/@@|\.\.|\.$/.test(email.toLowerCase())) {
    return { ok: false, reason: "formato_invalido_signos" };
  }

  // Si el dominio exacto está en conocidos → ok
  if (KNOWN_DOMAINS.has(domain)) return { ok: true };

  // Typo conocido
  if (TYPO_MAP[domain]) {
    return {
      ok: false,
      reason: "typo_conocido",
      suggestion: `${local}@${TYPO_MAP[domain]}`,
    };
  }

  // TLD inválido conocido
  for (const bad of INVALID_TLD_ENDINGS) {
    if (domain.endsWith(bad)) {
      const stem = domain.slice(0, -bad.length);
      // Intentar sugerir .com como fallback más probable
      const candidate = `${stem}.com`;
      return {
        ok: false,
        reason: "tld_invalido",
        suggestion: KNOWN_DOMAINS.has(candidate) ? `${local}@${candidate}` : undefined,
      };
    }
  }

  // Dominio desconocido pero bien formado: no bloqueamos (puede ser dominio
  // corporativo legítimo tipo "empresa.de", "universidad.edu"…). Sólo warn.
  return { ok: true };
}

/**
 * Para usar en Zod refine: lanza error si hay typo.
 * Devuelve el email corregido si suggestion existe (útil frontend).
 */
export function emailOrThrow(email: string): string {
  const check = checkEmailTypo(email);
  if (check.ok) return email.trim().toLowerCase();
  const sug = "suggestion" in check && check.suggestion ? ` — ¿quisiste decir ${check.suggestion}?` : "";
  throw new Error(`email con posible typo (${check.reason})${sug}`);
}
