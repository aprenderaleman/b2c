"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Widget de referidos del portal del estudiante:
 *   - Botón fijo en el header: "🎁 Regala una clase — gana 3"
 *   - Modal con link, [Copiar], [Compartir por WhatsApp] y contadores
 *   - Popup automático de "momentos de victoria" (máx 1/mes, lo
 *     decide el servidor vía /api/me/referral → victory)
 */

type ReferralData = {
  ok: boolean;
  code: string | null;
  link: string | null;
  invited_count: number;
  converted_count: number;
  classes_earned: number;
  victory: string | null;
};

export function ReferralWidget() {
  const [data, setData] = useState<ReferralData | null>(null);
  const [open, setOpen] = useState(false);
  const [victoryOpen, setVictoryOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/me/referral")
      .then(r => r.ok ? r.json() : null)
      .then((d: ReferralData | null) => {
        if (!alive || !d?.ok) return;
        setData(d);
        if (d.victory) {
          setVictoryOpen(true);
          // Marcar como visto AL MOSTRARSE (no solo al cerrar). Caso
          // Ayman 2026-08-18: el popup quedó imposible de cerrar por un
          // bug de posicionamiento y, como el dismiss nunca corría,
          // reaparecía en cada página. Con esto el throttle 1/mes se
          // aplica pase lo que pase con el UI.
          fetch("/api/me/referral", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "dismiss_popup" }),
          }).catch(() => {});
        }
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  // Cerrar con ESC cualquiera de los dos modales.
  useEffect(() => {
    if (!open && !victoryOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOpen(false); setVictoryOpen(false); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, victoryOpen]);

  if (!data) return null;

  const link = data.link ?? "";
  const waText = encodeURIComponent(
    `¡Estoy aprendiendo alemán en Aprender-Alemán y me está yendo genial! 😊 Si te inscribes con mi enlace te regalan una clase: ${link}`,
  );

  const copy = () => {
    navigator.clipboard.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  };

  const dismissVictory = () => {
    setVictoryOpen(false);
    fetch("/api/me/referral", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "dismiss_popup" }),
    }).catch(() => {});
  };

  // PORTAL a document.body: el widget vive dentro del header del
  // AppShell, que tiene backdrop-blur — ese filtro convierte al header
  // en containing block de los descendientes position:fixed, así que
  // el modal quedaba anclado al header (arriba, sin fondo y con la ✕
  // fuera de pantalla — caso Ayman 2026-08-18). El portal lo saca al
  // body y el fixed vuelve a ser relativo al viewport.
  const modal = (title: string, subtitle: React.ReactNode, onClose: () => void) => createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-6 shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3.5 right-3.5 w-9 h-9 rounded-full flex items-center justify-center text-slate-500 dark:text-slate-300 text-lg font-bold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700"
          aria-label="Cerrar"
        >
          ✕
        </button>
        <div className="text-center">
          <div className="text-4xl mb-2" aria-hidden>🎁</div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-50">{title}</h2>
          <div className="mt-1.5 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
            {subtitle}
          </div>
        </div>

        <div className="mt-5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2.5 flex items-center gap-2">
          <code className="flex-1 text-xs break-all text-slate-700 dark:text-slate-200">{link}</code>
          <button
            type="button"
            onClick={copy}
            className="shrink-0 text-xs font-semibold rounded-lg bg-brand-100 dark:bg-brand-500/15 text-brand-700 dark:text-brand-300 px-2.5 py-1.5 hover:bg-brand-200 dark:hover:bg-brand-500/25"
          >
            {copied ? "✓ Copiado" : "Copiar"}
          </button>
        </div>

        <a
          href={`https://wa.me/?text=${waText}`}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 w-full h-11 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white font-semibold text-sm flex items-center justify-center gap-2 transition"
        >
          💬 Compartir por WhatsApp
        </a>

        <p className="mt-4 text-center text-xs text-slate-500 dark:text-slate-400">
          Amigos invitados: <strong>{data.invited_count}</strong> · Clases ganadas: <strong>{data.classes_earned}</strong>
        </p>

        <button
          type="button"
          onClick={onClose}
          className="mt-3 w-full h-10 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
        >
          Cerrar
        </button>
      </div>
    </div>,
    document.body,
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="h-9 inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-amber-400 to-orange-500 px-3 sm:px-3.5 text-xs font-bold text-white shadow-sm hover:shadow-md hover:brightness-105 transition whitespace-nowrap"
      >
        🎁 <span className="hidden sm:inline">Regala una clase — gana 3</span><span className="sm:hidden">Gana 3 clases</span>
      </button>

      {open && modal(
        "Regala una clase — gana 3",
        <>Invita a un amigo: él recibe una clase de regalo al inscribirse
        y tú ganas <strong>3 clases 1 a 1 gratis</strong>.</>,
        () => setOpen(false),
      )}

      {victoryOpen && !open && modal(
        `🎉 ${data.victory}`,
        <>¿Conoces a alguien que también quiera lograrlo? Regálale una clase 👇</>,
        dismissVictory,
      )}
    </>
  );
}
