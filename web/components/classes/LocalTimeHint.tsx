"use client";

import { berlinWallClockToIso } from "@/lib/schedule";

/**
 * Debajo de un campo de hora (que SIEMPRE es hora de Berlín) muestra la
 * equivalencia en la zona horaria del navegador del profe. Solo aparece si
 * el navegador no está en Europe/Berlin. Caso Simon 2026-10-01: desde
 * Latinoamérica escribía su hora local y la clase quedaba 7 h antes.
 */
export function LocalTimeHint({ dateYmd, hhmm }: { dateYmd: string; hhmm: string }) {
  if (!dateYmd || !hhmm || typeof Intl === "undefined") return null;
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (!tz || tz === "Europe/Berlin") return null;
  let local: string;
  try {
    const d = new Date(berlinWallClockToIso(dateYmd, hhmm.slice(0, 5)));
    if (Number.isNaN(d.getTime())) return null;
    local = d.toLocaleString("es-ES", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: tz });
  } catch { return null; }
  return (
    <p className="mt-1 text-[11px] leading-snug text-amber-700 dark:text-amber-300">
      En tu zona horaria ({tz.split("/").pop()?.replace(/_/g, " ")}): <strong>{local}</strong>. Escribe siempre la hora de Berlín.
    </p>
  );
}
