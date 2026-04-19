"use client";

import { useState } from "react";

/**
 * One-click "Sincronizar con Google Calendar" card.
 *
 * Opens a modal with:
 *   1. The user's personal iCal URL (short hex token, per-user).
 *   2. A direct "Abrir en Google Calendar" deep link.
 *   3. Instructions for Apple Calendar + Outlook.
 *
 * The calendar is read-only from the user's side; we emit classes with
 * their LiveKit room URL as the location, so tapping the event in any
 * calendar app takes them right to the classroom.
 */
export function CalendarSyncButton({ icalUrl }: { icalUrl: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(icalUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  };

  // Google's "add by URL" deep link. When it opens, Google asks the user
  // to confirm + subscribe. No OAuth, no backend token exchange.
  const googleUrl = `https://calendar.google.com/calendar/u/0/r?cid=${encodeURIComponent(icalUrl)}`;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 hover:border-brand-400 hover:text-brand-600 dark:hover:text-brand-400 transition-colors"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
          <rect x="3" y="4" width="18" height="18" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M3 10h18M8 2v4M16 2v4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        Sincronizar con mi calendario
      </button>

      {open && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal>
          <button type="button" onClick={() => setOpen(false)} className="absolute inset-0 bg-black/60" aria-label="Cerrar" />
          <div className="absolute inset-0 sm:inset-auto sm:left-1/2 sm:top-20 sm:-translate-x-1/2 sm:w-[560px] sm:max-w-[92vw] sm:rounded-3xl bg-white dark:bg-slate-900 sm:border border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col max-h-screen overflow-y-auto">
            <header className="flex items-center justify-between p-5 border-b border-slate-100 dark:border-slate-800">
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-50">Tu calendario de Aprender-Aleman.de</h2>
              <button type="button" onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 text-2xl leading-none">×</button>
            </header>

            <div className="p-5 space-y-5 text-sm">
              <p className="text-slate-600 dark:text-slate-300">
                Suscribe este enlace en el calendario que uses. Cada clase que agendemos aparece automáticamente
                con el link del aula virtual — tocas el evento, entras a la clase.
              </p>

              <div>
                <label className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Tu enlace personal (privado — no lo compartas)
                </label>
                <div className="mt-1 flex gap-2">
                  <input
                    type="text"
                    readOnly
                    value={icalUrl}
                    onClick={(e) => (e.target as HTMLInputElement).select()}
                    className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs font-mono text-slate-900 dark:text-slate-50"
                  />
                  <button
                    type="button"
                    onClick={copyUrl}
                    className="shrink-0 rounded-xl border border-brand-200 dark:border-brand-500/30 bg-brand-50 dark:bg-brand-500/10 text-brand-700 dark:text-brand-300 hover:bg-brand-100 px-3 py-2 text-xs font-medium"
                  >
                    {copied ? "Copiado ✓" : "Copiar"}
                  </button>
                </div>
              </div>

              <a
                href={googleUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="block w-full rounded-2xl bg-brand-500 hover:bg-brand-600 px-4 py-3 text-center text-sm font-semibold text-white transition-colors"
              >
                📅 Abrir en Google Calendar
              </a>

              <details className="rounded-2xl border border-slate-200 dark:border-slate-800 p-4 text-xs text-slate-600 dark:text-slate-300">
                <summary className="cursor-pointer font-medium text-slate-700 dark:text-slate-200">
                  ¿Usas Apple Calendar o Outlook?
                </summary>
                <ul className="mt-3 space-y-2 list-disc pl-5">
                  <li><strong>Apple Calendar</strong>: Archivo → Nueva suscripción a calendario → pega el enlace.</li>
                  <li><strong>Outlook</strong>: Calendario → Añadir calendario → Suscribirse desde web → pega el enlace.</li>
                  <li><strong>Móvil</strong>: abre el enlace en Safari (iOS) o navegador (Android) y elige "Añadir a calendario".</li>
                </ul>
              </details>

              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Los calendarios actualizan cada 1-24 horas dependiendo del cliente. Cambios urgentes (cancelaciones)
                también te llegan por WhatsApp y email.
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
