/**
 * Map IANA timezone identifiers (`Intl.DateTimeFormat().resolvedOptions().timeZone`)
 * to the most likely country prefix for our lead base.
 *
 * Coverage: DACH + España + países hispanohablantes de LATAM. Cualquier
 * TZ no listada cae al default (Alemania, +49) — coincide con el target
 * principal del negocio.
 *
 * Por qué hardcodeado: no necesitamos una librería completa. Las TZs
 * cambian con poca frecuencia, y para nuestros leads (LATAM + DACH + ES)
 * este lookup cubre >99 % del tráfico esperado.
 */

export type CountryPrefix = {
  countryCode:  string; // E.164 prefix con "+"
  country:      string; // ISO 3166-1 alpha-2
  /** Número de ejemplo (solo dígitos locales, SIN prefijo).
   *  Se usa como placeholder del input para guiar al lead. */
  examplePhone: string;
};

/**
 * Mapa explícito IANA TZ → prefix. Lista basada en CLDR + Wikipedia.
 * Mantener ordenado por continente/país para que sea fácil de auditar.
 */
// Ejemplos de móviles por país. Solo los dígitos del número local
// (SIN prefijo de país). Tomados de planes de numeración reales para
// que el placeholder se vea verosímil. Si el lead deja ese valor
// literal nuestro validador lo rechazará — es solo visual.
const _DE = "15253409644";
const _AT = "660123456";
const _CH = "761234567";
const _ES = "612345678";
const _MX = "5512345678";
const _AR = "91123456789";
const _CO = "3123456789";
const _PE = "912345678";
const _CL = "912345678";
const _VE = "4141234567";
const _BO = "71234567";
const _PY = "961234567";
const _UY = "94123456";
const _EC = "991234567";
const _CR = "61234567";
const _PA = "61234567";
const _SV = "70123456";
const _HN = "91234567";
const _NI = "81234567";
const _GT = "51234567";
const _CU = "51234567";
const _DO = "8091234567";
const _BR = "11912345678";

const TZ_TO_COUNTRY: Record<string, CountryPrefix> = {
  // --- DACH + ES ---
  "Europe/Berlin":          { countryCode: "+49",  country: "DE", examplePhone: _DE },
  "Europe/Busingen":        { countryCode: "+49",  country: "DE", examplePhone: _DE },
  "Europe/Vienna":          { countryCode: "+43",  country: "AT", examplePhone: _AT },
  "Europe/Zurich":          { countryCode: "+41",  country: "CH", examplePhone: _CH },
  "Europe/Madrid":          { countryCode: "+34",  country: "ES", examplePhone: _ES },
  "Atlantic/Canary":        { countryCode: "+34",  country: "ES", examplePhone: _ES },
  "Africa/Ceuta":           { countryCode: "+34",  country: "ES", examplePhone: _ES },

  // --- LATAM hispanohablante ---
  "America/Mexico_City":    { countryCode: "+52",  country: "MX", examplePhone: _MX },
  "America/Cancun":         { countryCode: "+52",  country: "MX", examplePhone: _MX },
  "America/Merida":         { countryCode: "+52",  country: "MX", examplePhone: _MX },
  "America/Monterrey":      { countryCode: "+52",  country: "MX", examplePhone: _MX },
  "America/Matamoros":      { countryCode: "+52",  country: "MX", examplePhone: _MX },
  "America/Chihuahua":      { countryCode: "+52",  country: "MX", examplePhone: _MX },
  "America/Ciudad_Juarez":  { countryCode: "+52",  country: "MX", examplePhone: _MX },
  "America/Hermosillo":     { countryCode: "+52",  country: "MX", examplePhone: _MX },
  "America/Mazatlan":       { countryCode: "+52",  country: "MX", examplePhone: _MX },
  "America/Ojinaga":        { countryCode: "+52",  country: "MX", examplePhone: _MX },
  "America/Tijuana":        { countryCode: "+52",  country: "MX", examplePhone: _MX },
  "America/Bahia_Banderas": { countryCode: "+52",  country: "MX", examplePhone: _MX },

  "America/Argentina/Buenos_Aires":  { countryCode: "+54", country: "AR", examplePhone: _AR },
  "America/Argentina/Cordoba":       { countryCode: "+54", country: "AR", examplePhone: _AR },
  "America/Argentina/Mendoza":       { countryCode: "+54", country: "AR", examplePhone: _AR },
  "America/Argentina/Salta":         { countryCode: "+54", country: "AR", examplePhone: _AR },
  "America/Argentina/Jujuy":         { countryCode: "+54", country: "AR", examplePhone: _AR },
  "America/Argentina/Tucuman":       { countryCode: "+54", country: "AR", examplePhone: _AR },
  "America/Argentina/Catamarca":     { countryCode: "+54", country: "AR", examplePhone: _AR },
  "America/Argentina/La_Rioja":      { countryCode: "+54", country: "AR", examplePhone: _AR },
  "America/Argentina/San_Juan":      { countryCode: "+54", country: "AR", examplePhone: _AR },
  "America/Argentina/San_Luis":      { countryCode: "+54", country: "AR", examplePhone: _AR },
  "America/Argentina/Rio_Gallegos":  { countryCode: "+54", country: "AR", examplePhone: _AR },
  "America/Argentina/Ushuaia":       { countryCode: "+54", country: "AR", examplePhone: _AR },

  "America/Bogota":         { countryCode: "+57",  country: "CO", examplePhone: _CO },
  "America/Lima":           { countryCode: "+51",  country: "PE", examplePhone: _PE },
  "America/Santiago":       { countryCode: "+56",  country: "CL", examplePhone: _CL },
  "America/Punta_Arenas":   { countryCode: "+56",  country: "CL", examplePhone: _CL },
  "Pacific/Easter":         { countryCode: "+56",  country: "CL", examplePhone: _CL },
  "America/Caracas":        { countryCode: "+58",  country: "VE", examplePhone: _VE },
  "America/La_Paz":         { countryCode: "+591", country: "BO", examplePhone: _BO },
  "America/Asuncion":       { countryCode: "+595", country: "PY", examplePhone: _PY },
  "America/Montevideo":     { countryCode: "+598", country: "UY", examplePhone: _UY },
  "America/Guayaquil":      { countryCode: "+593", country: "EC", examplePhone: _EC },
  "Pacific/Galapagos":      { countryCode: "+593", country: "EC", examplePhone: _EC },

  "America/Costa_Rica":     { countryCode: "+506", country: "CR", examplePhone: _CR },
  "America/Panama":         { countryCode: "+507", country: "PA", examplePhone: _PA },
  "America/El_Salvador":    { countryCode: "+503", country: "SV", examplePhone: _SV },
  "America/Tegucigalpa":    { countryCode: "+504", country: "HN", examplePhone: _HN },
  "America/Managua":        { countryCode: "+505", country: "NI", examplePhone: _NI },
  "America/Guatemala":      { countryCode: "+502", country: "GT", examplePhone: _GT },
  "America/Havana":         { countryCode: "+53",  country: "CU", examplePhone: _CU },
  "America/Santo_Domingo":  { countryCode: "+1",   country: "DO", examplePhone: _DO },
  "America/Puerto_Rico":    { countryCode: "+1",   country: "DO", examplePhone: _DO },

  // --- Brasil (no es target hispanohablante pero llega tráfico) ---
  "America/Sao_Paulo":      { countryCode: "+55",  country: "BR", examplePhone: _BR },
  "America/Bahia":          { countryCode: "+55",  country: "BR", examplePhone: _BR },
  "America/Fortaleza":      { countryCode: "+55",  country: "BR", examplePhone: _BR },
  "America/Recife":         { countryCode: "+55",  country: "BR", examplePhone: _BR },
  "America/Belem":          { countryCode: "+55",  country: "BR", examplePhone: _BR },
  "America/Manaus":         { countryCode: "+55",  country: "BR", examplePhone: _BR },
};

/**
 * Default fallback cuando la TZ del navegador no está en la tabla o no
 * podemos detectarla. DACH es nuestro mercado principal.
 */
export const DEFAULT_COUNTRY: CountryPrefix = { countryCode: "+49", country: "DE", examplePhone: _DE };

/**
 * Detecta el prefijo desde la TZ del navegador. Lado cliente only —
 * devuelve `null` si `Intl` no está disponible (SSR).
 */
export function detectCountryFromBrowser(): CountryPrefix | null {
  try {
    if (typeof Intl === "undefined") return null;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!tz) return null;
    return TZ_TO_COUNTRY[tz] ?? null;
  } catch {
    return null;
  }
}

/**
 * Detecta TZ del navegador (string). Útil para mostrar al lead en qué
 * zona vemos sus horarios.
 */
export function detectBrowserTimezone(): string | null {
  try {
    if (typeof Intl === "undefined") return null;
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
  } catch {
    return null;
  }
}

/**
 * Mapa inverso: prefijo país → TZ representativa (la más poblada).
 *
 * Por qué existe: cuando el navegador del lead reporta TZ raro (UTC,
 * Europe/Berlin por VPN, vacío en in-app browsers), todavía podemos
 * inferir su zona horaria real desde el prefijo que tecleó en el campo
 * WhatsApp. Caso real Martin (2026-06-17): peruano (+51) que vio "09:30"
 * pensando que era su hora local — eran las 02:30 AM Lima. El browser
 * no detectó America/Lima pero el +51 lo delataba.
 *
 * Países con múltiples TZs (USA, Rusia, México partes): elegimos la
 * TZ de la región MÁS POBLADA. Tradeoff aceptado: un mexicano en Tijuana
 * verá su hora calculada como Mexico_City (Tijuana es PST, CDMX es CST,
 * 2h diferencia). Mejor que mostrar todo en Berlin.
 *
 * Si el prefijo no está mapeado o coincide con DACH (+49/+43/+41),
 * devuelve null — usar TZ del navegador o Berlin como default.
 */
const PREFIX_TO_TIMEZONE: Record<string, string> = {
  // LATAM hispanohablante
  "+52":  "America/Mexico_City",
  "+54":  "America/Argentina/Buenos_Aires",
  "+57":  "America/Bogota",
  "+51":  "America/Lima",
  "+56":  "America/Santiago",
  "+58":  "America/Caracas",
  "+591": "America/La_Paz",
  "+595": "America/Asuncion",
  "+598": "America/Montevideo",
  "+593": "America/Guayaquil",
  "+506": "America/Costa_Rica",
  "+507": "America/Panama",
  "+503": "America/El_Salvador",
  "+504": "America/Tegucigalpa",
  "+505": "America/Managua",
  "+502": "America/Guatemala",
  "+53":  "America/Havana",
  // España (UTC+1/+2 igual que Berlin, no necesita dual-TZ — pero
  // Canarias es UTC+0/+1 → 1h menos. Para simplificar usamos
  // Europe/Madrid; en práctica el dual-TZ no se activará porque
  // coincide con Berlin en hora estándar la mayor parte del año).
  "+34":  "Europe/Madrid",
  // Brasil — múltiples TZs, usamos Sao_Paulo (mayoría de la población)
  "+55":  "America/Sao_Paulo",
  // DACH: deliberadamente sin entry — son los defaults, no aplica dual-TZ
};

export function timezoneFromPrefix(prefix: string | null | undefined): string | null {
  if (!prefix) return null;
  const normalized = prefix.startsWith("+") ? prefix : `+${prefix}`;
  return PREFIX_TO_TIMEZONE[normalized] ?? null;
}

/**
 * Decide la TZ "efectiva" del lead combinando 2 señales:
 *   1. TZ del navegador (si != Berlin/UTC/null)
 *   2. TZ inferida del prefijo WhatsApp (si != DACH)
 *
 * El prefijo gana sobre el navegador si el navegador devolvió algo no
 * útil (UTC, Berlin por VPN, etc). Si ninguna señal apunta a no-DACH,
 * devuelve null → el caller usa Berlin como default y NO muestra dual-TZ.
 */
export function effectiveLeadTimezone(args: {
  browserTimezone: string | null;
  whatsappPrefix:  string | null;
}): string | null {
  const fromBrowser = args.browserTimezone;
  const fromPrefix  = timezoneFromPrefix(args.whatsappPrefix);
  // Browser TZ útil = existe, no es Berlin, no es UTC genérico
  const browserUseful = !!fromBrowser
    && fromBrowser !== "Europe/Berlin"
    && fromBrowser !== "UTC"
    && fromBrowser !== "Etc/UTC";
  if (browserUseful) return fromBrowser;
  // Fallback al prefijo si revela una TZ no-DACH
  if (fromPrefix && fromPrefix !== "Europe/Berlin") return fromPrefix;
  return null;
}
