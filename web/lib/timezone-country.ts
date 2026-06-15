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
  countryCode: string; // E.164 prefix con "+"
  country:     string; // ISO 3166-1 alpha-2
};

/**
 * Mapa explícito IANA TZ → prefix. Lista basada en CLDR + Wikipedia.
 * Mantener ordenado por continente/país para que sea fácil de auditar.
 */
const TZ_TO_COUNTRY: Record<string, CountryPrefix> = {
  // --- DACH + ES ---
  "Europe/Berlin":          { countryCode: "+49",  country: "DE" },
  "Europe/Busingen":        { countryCode: "+49",  country: "DE" },
  "Europe/Vienna":          { countryCode: "+43",  country: "AT" },
  "Europe/Zurich":          { countryCode: "+41",  country: "CH" },
  "Europe/Madrid":          { countryCode: "+34",  country: "ES" },
  "Atlantic/Canary":        { countryCode: "+34",  country: "ES" },
  "Africa/Ceuta":           { countryCode: "+34",  country: "ES" },

  // --- LATAM hispanohablante ---
  "America/Mexico_City":    { countryCode: "+52",  country: "MX" },
  "America/Cancun":         { countryCode: "+52",  country: "MX" },
  "America/Merida":         { countryCode: "+52",  country: "MX" },
  "America/Monterrey":      { countryCode: "+52",  country: "MX" },
  "America/Matamoros":      { countryCode: "+52",  country: "MX" },
  "America/Chihuahua":      { countryCode: "+52",  country: "MX" },
  "America/Ciudad_Juarez":  { countryCode: "+52",  country: "MX" },
  "America/Hermosillo":     { countryCode: "+52",  country: "MX" },
  "America/Mazatlan":       { countryCode: "+52",  country: "MX" },
  "America/Ojinaga":        { countryCode: "+52",  country: "MX" },
  "America/Tijuana":        { countryCode: "+52",  country: "MX" },
  "America/Bahia_Banderas": { countryCode: "+52",  country: "MX" },

  "America/Argentina/Buenos_Aires":  { countryCode: "+54", country: "AR" },
  "America/Argentina/Cordoba":       { countryCode: "+54", country: "AR" },
  "America/Argentina/Mendoza":       { countryCode: "+54", country: "AR" },
  "America/Argentina/Salta":         { countryCode: "+54", country: "AR" },
  "America/Argentina/Jujuy":         { countryCode: "+54", country: "AR" },
  "America/Argentina/Tucuman":       { countryCode: "+54", country: "AR" },
  "America/Argentina/Catamarca":     { countryCode: "+54", country: "AR" },
  "America/Argentina/La_Rioja":      { countryCode: "+54", country: "AR" },
  "America/Argentina/San_Juan":      { countryCode: "+54", country: "AR" },
  "America/Argentina/San_Luis":      { countryCode: "+54", country: "AR" },
  "America/Argentina/Rio_Gallegos":  { countryCode: "+54", country: "AR" },
  "America/Argentina/Ushuaia":       { countryCode: "+54", country: "AR" },

  "America/Bogota":         { countryCode: "+57",  country: "CO" },
  "America/Lima":           { countryCode: "+51",  country: "PE" },
  "America/Santiago":       { countryCode: "+56",  country: "CL" },
  "America/Punta_Arenas":   { countryCode: "+56",  country: "CL" },
  "Pacific/Easter":         { countryCode: "+56",  country: "CL" },
  "America/Caracas":        { countryCode: "+58",  country: "VE" },
  "America/La_Paz":         { countryCode: "+591", country: "BO" },
  "America/Asuncion":       { countryCode: "+595", country: "PY" },
  "America/Montevideo":     { countryCode: "+598", country: "UY" },
  "America/Guayaquil":      { countryCode: "+593", country: "EC" },
  "Pacific/Galapagos":      { countryCode: "+593", country: "EC" },

  "America/Costa_Rica":     { countryCode: "+506", country: "CR" },
  "America/Panama":         { countryCode: "+507", country: "PA" },
  "America/El_Salvador":    { countryCode: "+503", country: "SV" },
  "America/Tegucigalpa":    { countryCode: "+504", country: "HN" },
  "America/Managua":        { countryCode: "+505", country: "NI" },
  "America/Guatemala":      { countryCode: "+502", country: "GT" },
  "America/Havana":         { countryCode: "+53",  country: "CU" },
  "America/Santo_Domingo":  { countryCode: "+1",   country: "DO" },
  "America/Puerto_Rico":    { countryCode: "+1",   country: "PR" },

  // --- Brasil (no es target hispanohablante pero llega tráfico) ---
  "America/Sao_Paulo":      { countryCode: "+55",  country: "BR" },
  "America/Bahia":          { countryCode: "+55",  country: "BR" },
  "America/Fortaleza":      { countryCode: "+55",  country: "BR" },
  "America/Recife":         { countryCode: "+55",  country: "BR" },
  "America/Belem":          { countryCode: "+55",  country: "BR" },
  "America/Manaus":         { countryCode: "+55",  country: "BR" },
};

/**
 * Default fallback cuando la TZ del navegador no está en la tabla o no
 * podemos detectarla. DACH es nuestro mercado principal.
 */
export const DEFAULT_COUNTRY: CountryPrefix = { countryCode: "+49", country: "DE" };

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
