"use client";

import { useEffect, useState } from "react";

/**
 * Pantalla de espera previa a la clase. Sustituye al CTA de SCHULE
 * (decisión Gelfis 2026-05-10: confundía al lead — entraba a SCHULE
 * y no volvía a tiempo).
 *
 * Muestra:
 *   - cuenta atrás en tiempo real hasta que el aula abre
 *   - botón "Recargar" para que el lead pueda re-entrar manualmente
 *   - auto-recarga cuando llega al opensAt para no obligarles a refrescar
 */
export function WaitingForAula({
  opensAtIso,
  classTitle,
  startTimeBerlinFormatted,
}: {
  opensAtIso:               string;
  classTitle:               string;
  startTimeBerlinFormatted: string;
}) {
  const opensAt = new Date(opensAtIso).getTime();
  const [remainingMs, setRemainingMs] = useState<number>(() => Math.max(0, opensAt - Date.now()));

  useEffect(() => {
    const id = setInterval(() => {
      const r = opensAt - Date.now();
      setRemainingMs(Math.max(0, r));
      // Auto-recarga 1s después del opensAt — el SSR pillará la nueva
      // ventana válida y mostrará el aula en vez de esta pantalla.
      if (r <= -1000) window.location.reload();
    }, 1000);
    return () => clearInterval(id);
  }, [opensAt]);

  const open = remainingMs === 0;
  const totalSec   = Math.floor(remainingMs / 1000);
  const days       = Math.floor(totalSec / 86400);
  const hours      = Math.floor((totalSec % 86400) / 3600);
  const minutes    = Math.floor((totalSec % 3600) / 60);
  const seconds    = totalSec % 60;

  let countdown: string;
  if (days > 0)        countdown = `${days}d ${hours}h ${minutes}m`;
  else if (hours > 0)  countdown = `${hours}h ${minutes}m ${String(seconds).padStart(2, "0")}s`;
  else                 countdown = `${minutes}m ${String(seconds).padStart(2, "0")}s`;

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-950 to-slate-900 text-slate-100 flex items-center justify-center px-5 py-10">
      <div className="w-full max-w-lg rounded-3xl bg-slate-800/60 backdrop-blur border border-slate-700 p-8 text-center shadow-2xl">
        <div className="text-5xl mb-4" aria-hidden>{open ? "✅" : "⏳"}</div>
        <h1 className="text-2xl font-bold">{classTitle}</h1>
        <p className="mt-3 text-slate-300">
          Inicio: <strong className="text-brand-300">{startTimeBerlinFormatted}</strong>
        </p>

        <div className="mt-6 rounded-2xl border border-slate-700 bg-slate-900/60 p-5">
          {open ? (
            <p className="text-sm text-emerald-300 font-semibold">
              ¡El aula está abierta! Recargando…
            </p>
          ) : (
            <>
              <p className="text-xs uppercase tracking-wider text-slate-400">
                El aula abre en
              </p>
              <p className="mt-2 text-3xl font-mono font-bold text-brand-300 tabular-nums">
                {countdown}
              </p>
              <p className="mt-3 text-xs text-slate-400">
                Se abre 15 minutos antes del inicio.
              </p>
            </>
          )}
        </div>

        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-6 inline-flex items-center gap-2 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-semibold px-5 py-2.5 transition-colors"
        >
          🔄 Recargar
        </button>

        <p className="mt-5 text-xs text-slate-500">
          Si tienes algún problema, escríbenos por WhatsApp y te ayudamos.
        </p>
      </div>
    </main>
  );
}
