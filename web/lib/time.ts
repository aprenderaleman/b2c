/**
 * One place to format trial / class times so the LMS, the admin
 * dashboard, the funnel, the emails and the WhatsApp templates all
 * agree on the same string. Always Europe/Berlin — the academy lives
 * there, every teacher books in Berlin time, and Spain is in the
 * SAME zone year-round (CEST in summer, CET in winter), so there's
 * no need to dual-print "Berlín / Madrid" — they're the same hour.
 */

export type Lang = "es" | "de";

const LOCALE: Record<Lang, string> = {
  es: "es-ES",
  de: "de-DE",
};

const SUFFIX: Record<Lang, string> = {
  es: " (Berlín)",
  de: " (Berlin)",
};

/** "miércoles 29 de abril, 19:00 (Berlín)" */
export function formatBerlinFull(iso: string | Date, lang: Lang = "es"): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return d.toLocaleString(LOCALE[lang], {
    timeZone: "Europe/Berlin",
    weekday:  "long",
    day:      "numeric",
    month:    "long",
    hour:     "2-digit",
    minute:   "2-digit",
  }) + SUFFIX[lang];
}

/** "29/4/2026 19:00 (Berlín)" — short, dense form for tables. */
export function formatBerlinShort(iso: string | Date, lang: Lang = "es"): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return d.toLocaleString(LOCALE[lang], {
    timeZone: "Europe/Berlin",
    day:      "numeric",
    month:    "numeric",
    year:     "numeric",
    hour:     "2-digit",
    minute:   "2-digit",
  }) + SUFFIX[lang];
}

/** "19:00 (Berlín)" — just the clock, e.g. for reminders where the date is implicit. */
export function formatBerlinTime(iso: string | Date, lang: Lang = "es"): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return d.toLocaleTimeString(LOCALE[lang], {
    timeZone: "Europe/Berlin",
    hour:     "2-digit",
    minute:   "2-digit",
  }) + SUFFIX[lang];
}
