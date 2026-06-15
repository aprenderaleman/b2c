// TypeScript mirror of agents/shared/phone.py — keep the two in sync.
//
// Rules:
//   1. If raw starts with "+" → already international, strip non-digits, keep +
//   2. If raw (digits) starts with "00" → strip, prepend +
//   3. If raw (digits) starts with "0" → domestic trunk prefix, strip & prepend +defaultCountry
//   4. Else if raw starts with a known country code AND remainder is plausible → prepend +
//   5. Else prepend +defaultCountry

const KNOWN_CC = [
  "34", "41", "43", "44", "49",
  "51", "52", "53", "54", "55", "56", "57", "58",
  "502", "503", "504", "505", "506", "507",
  "591", "593", "595", "598",
].sort((a, b) => b.length - a.length);

export function normalizePhone(raw: string, defaultCountry = "49"): string {
  if (raw == null) throw new Error("Phone number is empty");
  const hadPlus = raw.trim().startsWith("+");
  let digits = raw.replace(/\D/g, "");
  if (!digits) throw new Error("Phone number contains no digits");

  if (hadPlus) {
    // Common user mistake A: selecting "+49" in the dropdown AND typing
    // the national trunk 0 in the number field ("+49 0152…").
    digits = stripTrunkZeroAfterCC(digits, defaultCountry);
    // Common user mistake B (the +3434641… class): selecting "+34" in
    // the dropdown AND retyping "34" inside the number field. Detect
    // when the digits start with the dropdown CC TWICE in a row and
    // strip one copy. We only do this when the leftover number length
    // is still plausibly a real subscriber number (>= 6 digits) so we
    // don't mangle short legit numbers in country codes that happen
    // to repeat.
    digits = stripDuplicatedCC(digits, defaultCountry);
    return "+" + digits;
  }
  if (digits.startsWith("00")) return "+" + digits.slice(2);
  if (digits.startsWith("0")) return "+" + defaultCountry + digits.slice(1);

  for (const cc of KNOWN_CC) {
    if (digits.startsWith(cc) && digits.length - cc.length >= 6) {
      return "+" + digits;
    }
  }
  return "+" + defaultCountry + digits;
}

/**
 * Strip the user's accidental duplicate country code, e.g.:
 *   defaultCountry="34", digits="3434641051234" → "34641051234"
 *
 * Only fires when the country code appears IMMEDIATELY twice in a row.
 * We refuse to strip if the resulting number falls below 6 digits —
 * that would indicate a legitimate short number that just happens to
 * start with the country code's digits.
 */
function stripDuplicatedCC(digits: string, defaultCountry: string): string {
  const cc = defaultCountry.replace(/\D/g, "");
  if (!cc) return digits;
  const doubled = cc + cc;
  if (digits.startsWith(doubled) && digits.length - cc.length >= cc.length + 6) {
    return digits.slice(cc.length);
  }
  return digits;
}

function stripTrunkZeroAfterCC(digits: string, defaultCountry: string): string {
  const candidates = Array.from(new Set([...KNOWN_CC, defaultCountry]))
    .sort((a, b) => b.length - a.length);
  for (const cc of candidates) {
    if (digits.startsWith(cc) && digits[cc.length] === "0" && digits.length - cc.length - 1 >= 6) {
      return cc + digits.slice(cc.length + 1);
    }
  }
  return digits;
}

export function isValidE164(phone: string): boolean {
  return /^\+\d{8,15}$/.test(phone || "");
}

// ── Resolución inteligente de teléfono (libphonenumber) ────────────
//
// Caso real Gelfis 2026-05-27: lead español dejó el prefijo por defecto
// +49 (Alemania) y escribió su número completo con el 34 → quedó
// "+4934676482692". Las heurísticas de longitud no lo detectan porque
// 11 dígitos es válido para Alemania. La ÚNICA forma fiable de saber
// que "34676482692" no es alemán pero sí español es consultar los
// planes de numeración reales — eso lo hace libphonenumber-js.

import { parsePhoneNumberFromString } from "libphonenumber-js";

export type PhoneResolution = {
  /** E.164 final recomendado (ej. "+34676482692"). */
  e164:        string;
  /** ISO-2 del país detectado (ej. "ES"), o null si no se pudo. */
  country:     string | null;
  /** true si el número es válido según el plan de numeración. */
  valid:       boolean;
  /** true si el país detectado NO coincide con el prefijo seleccionado
   *  (el lead probablemente tecleó su número con otro código de país). */
  ccMismatch:  boolean;
  /** Prefijo detectado distinto al seleccionado (ej. "+34"), o null. */
  detectedCc:  string | null;
};

/**
 * Resuelve el teléfono combinando el prefijo del dropdown + lo que el
 * lead escribió, pero priorizando el plan de numeración real.
 *
 * Estrategia:
 *  1. Candidato A = prefijo seleccionado + número tecleado (saneado).
 *  2. Candidato B = número tecleado interpretado como internacional
 *     completo (por si el lead pegó su número con su propio CC).
 *  3. Si A es válido para su país → usar A (caso normal).
 *  4. Si A NO es válido pero B sí → el lead tecleó un número de otro
 *     país; usamos B y marcamos ccMismatch.
 *  5. Si ninguno es válido → devolver A con valid=false.
 */
// Prefijos que detectamos como "el lead tecleó su número completo con
// otro código de país". Ordenados de más largo a más corto para hacer
// match con el CC más específico primero.
//
// IMPORTANTE: excluimos +1 (EE.UU./Canadá) a propósito — colisiona con
// los móviles alemanes 15x/16x/17x (un alemán que teclea "15123456789"
// formaría "+15123456789" = US válido, falso positivo). Como este
// funnel es de mercado hispano/DACH, +1 no es un caso primario y el
// riesgo de romper números alemanes es mayor que el beneficio.
const FOREIGN_DETECT_CCS = [
  "598", "595", "591", "593", "506", "507", "502", "503", "504", "505", "351",
  "34", "54", "57", "52", "56", "51", "58", "53", "41", "43", "33", "39", "44", "31", "32",
].sort((a, b) => b.length - a.length);

export function resolvePhone(countryCode: string, localInput: string): PhoneResolution {
  const selectedCc = countryCode.startsWith("+") ? countryCode : `+${countryCode}`;
  const selectedCcDigits = selectedCc.replace(/\D/g, "");

  // Candidato A — prefijo seleccionado + número local saneado (fuerza
  // el CC del dropdown; replica combineE164 del componente).
  let aDigits = (localInput ?? "").replace(/\D/g, "");
  if (aDigits.startsWith("00")) aDigits = aDigits.slice(2);
  if (selectedCcDigits) {
    let guard = 4;
    while (guard-- > 0
           && aDigits.startsWith(selectedCcDigits)
           && aDigits.length - selectedCcDigits.length >= 6) {
      aDigits = aDigits.slice(selectedCcDigits.length);
    }
  }
  if (aDigits.startsWith("0")) aDigits = aDigits.slice(1);
  const aRaw = `+${selectedCcDigits}${aDigits}`;
  const a = parsePhoneNumberFromString(aRaw);

  // Candidato B — el lead tecleó su número completo con OTRO código de
  // país (caso real: +49 por defecto + número español "34676482692").
  // Sólo lo consideramos si el número tecleado EMPIEZA por un CC
  // conocido de nuestra lista (distinto al seleccionado) y al
  // interpretarlo como internacional libphonenumber lo valida.
  let typed = (localInput ?? "").replace(/\D/g, "");
  if (typed.startsWith("00")) typed = typed.slice(2);
  let b: ReturnType<typeof parsePhoneNumberFromString> | undefined;
  let detectedCc: string | null = null;
  if (!typed.startsWith(selectedCcDigits)) {
    for (const cc of FOREIGN_DETECT_CCS) {
      if (cc === selectedCcDigits) continue;
      if (typed.startsWith(cc)) {
        const cand = parsePhoneNumberFromString(`+${typed}`);
        // Validamos que sea un número válido Y que el CC que detecta
        // libphonenumber coincida con el que matcheamos (evita que
        // un número largo se interprete con otro CC por casualidad).
        if (cand && cand.isValid() && String(cand.countryCallingCode) === cc) {
          b = cand;
          detectedCc = `+${cc}`;
          break;
        }
      }
    }
  }

  // (1) Si detectamos un número extranjero válido → prevalece sobre A,
  //     incluso si A también "pasa" la validación laxa de su país.
  if (b && b.isValid() && detectedCc) {
    return {
      e164: b.number, country: b.country ?? null, valid: true,
      ccMismatch: detectedCc !== selectedCc, detectedCc,
    };
  }

  // (2) A válido → caso normal.
  if (a && a.isValid()) {
    return {
      e164: a.number, country: a.country ?? null, valid: true,
      ccMismatch: false, detectedCc: null,
    };
  }

  // (3) Ninguno válido.
  return {
    e164: aRaw, country: a?.country ?? null, valid: false,
    ccMismatch: false, detectedCc: null,
  };
}

/**
 * Rescate de doble-prefijo para un E.164 ya armado (server-side defense
 * in depth). Caso: "+4934676482692" donde tras el primer CC (49) viene
 * otro CC extranjero válido (34 + número español). libphonenumber
 * considera el número entero "válido" (Alemania es laxo), así que no
 * podemos confiar sólo en isValid() — aplicamos la misma lista de
 * detección que resolvePhone.
 *
 * Devuelve el E.164 corregido si detecta el patrón, o el original.
 */
export function rescueDoublePrefix(e164: string): string {
  const digits = (e164 ?? "").replace(/\D/g, "");
  if (!digits) return e164;

  // Probamos quitar un primer CC de 1-3 dígitos y ver si lo que queda
  // empieza por un CC extranjero conocido formando un número válido.
  for (const firstCcLen of [2, 3, 1]) {
    const rest = digits.slice(firstCcLen);
    for (const cc of FOREIGN_DETECT_CCS) {
      if (rest.startsWith(cc)) {
        const cand = parsePhoneNumberFromString(`+${rest}`);
        if (cand && cand.isValid() && String(cand.countryCallingCode) === cc) {
          return cand.number;
        }
      }
    }
  }
  return e164;
}

/**
 * Saneo defensivo de un E.164 que ya viene con `+`. Pensado para los
 * endpoints públicos que reciben el número ya armado por el frontend
 * pero pueden recibir formas malformadas:
 *   - Country code duplicado: "+3434615541087" → "+34615541087"
 *     (caso real Juan José 2026-05-07)
 *   - Espacios / guiones / paréntesis al guardarlos
 *   - Prefijo "00" en vez de "+"
 *
 * Aplica una heurística común: prueba con cada país conocido y si
 * detecta un duplicado de su código al inicio, lo colapsa.
 */
export function sanitizeE164(input: string): string {
  let s = (input ?? "").trim();
  if (!s) return s;
  s = "+" + s.replace(/^\+/, "").replace(/\D/g, "");
  if (s === "+") return s;
  if (s.startsWith("+00")) s = "+" + s.slice(3);
  const digits = s.slice(1);
  // Probar con todos los códigos conocidos (1-3 dígitos), ordenados de
  // más largo a más corto para preferir match con el CC más específico.
  const ccs = Array.from(new Set(KNOWN_CC)).sort((a, b) => b.length - a.length);
  for (const cc of ccs) {
    const doubled = cc + cc;
    if (digits.startsWith(doubled) && digits.length - cc.length >= 8) {
      return "+" + digits.slice(cc.length);
    }
  }
  return s;
}

export const COUNTRY_CODES: Array<{ code: string; label: string; flag: string }> = [
  { code: "+49", label: "Deutschland",  flag: "🇩🇪" },
  { code: "+34", label: "España",       flag: "🇪🇸" },
  { code: "+41", label: "Schweiz",      flag: "🇨🇭" },
  { code: "+43", label: "Österreich",   flag: "🇦🇹" },
  { code: "+52", label: "México",       flag: "🇲🇽" },
  { code: "+54", label: "Argentina",    flag: "🇦🇷" },
  { code: "+56", label: "Chile",        flag: "🇨🇱" },
  { code: "+57", label: "Colombia",     flag: "🇨🇴" },
  { code: "+51", label: "Perú",         flag: "🇵🇪" },
  { code: "+58", label: "Venezuela",    flag: "🇻🇪" },
  { code: "+593", label: "Ecuador",     flag: "🇪🇨" },
  { code: "+591", label: "Bolivia",     flag: "🇧🇴" },
  { code: "+595", label: "Paraguay",    flag: "🇵🇾" },
  { code: "+598", label: "Uruguay",     flag: "🇺🇾" },
];

/**
 * Combina el prefijo del dropdown + el número tecleado en un E.164
 * limpio. Resuelve los casos más frecuentes de "lead se equivoca al
 * escribir":
 *
 *   - "00..." al principio (notación internacional alternativa) → quita
 *   - CC duplicado al principio ("+49 491607...") → quita hasta 4 veces
 *   - "0" troncal al principio del número local (común en DE) → quita
 *
 * NO valida — devuelve siempre algo, válido o no. Para validación usar
 * `resolvePhone()`. Útil cuando ya pasaste la validación y solo quieres
 * el string E.164 final.
 *
 * Movida desde DiagnosticoFunnel.tsx (Gelfis 2026-06-15) para que
 * cualquier componente pueda importarla sin acarrear toda la lógica del
 * funnel viejo.
 */
export function combineE164(countryCode: string, localInput: string): string {
  const ccDigits = countryCode.replace(/\D/g, "");
  let digits = (localInput ?? "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (ccDigits) {
    let guard = 4;
    while (guard-- > 0
           && digits.startsWith(ccDigits)
           && digits.length - ccDigits.length >= 6) {
      digits = digits.slice(ccDigits.length);
    }
  }
  if (digits.startsWith("0")) digits = digits.slice(1);
  return `+${ccDigits}${digits}`;
}
