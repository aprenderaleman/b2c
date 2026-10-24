"use client";

import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import type { TourStep } from "@/lib/onboarding";

/**
 * Tour guiado por la pantalla real (Gelfis 2026-10-24). Señala elementos
 * con data-tour="<anchor>", oscurece el resto y muestra una tarjeta con el
 * texto. Si el ancla no está visible (p. ej. está dentro del menú «Más» en
 * móvil) la tarjeta se centra. Al terminar o saltar se registra el evento.
 *
 * Genérico: sirve para alumnos y profes (los pasos vienen del servidor).
 */
type Rect = { top: number; left: number; width: number; height: number };

const T = {
  es: { skip: "Saltar", back: "Atrás", next: "Siguiente", done: "¡Listo!", of: "de", inMenu: "Lo encuentras en el menú (en el móvil, dentro de «Más»)." },
  de: { skip: "Überspringen", back: "Zurück", next: "Weiter", done: "Fertig!", of: "von", inMenu: "Du findest es im Menü (am Handy unter «Mehr»)." },
};

export function GuidedTour({ steps, lang, onFinish }: { steps: TourStep[]; lang: "es" | "de"; onFinish?: () => void }) {
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [open, setOpen] = useState(true);
  const t = T[lang];
  const step = steps[i];

  const measure = useCallback(() => {
    if (!step?.anchor) { setRect(null); return; }
    const el = document.querySelector<HTMLElement>(`[data-tour="${step.anchor}"]`);
    if (!el) { setRect(null); return; }
    const r = el.getBoundingClientRect();
    const visible = r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight && getComputedStyle(el).visibility !== "hidden";
    if (!visible) {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      setTimeout(() => {
        const r2 = el.getBoundingClientRect();
        setRect(r2.width > 0 && r2.height > 0 ? { top: r2.top, left: r2.left, width: r2.width, height: r2.height } : null);
      }, 350);
      return;
    }
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
  }, [step]);

  useLayoutEffect(() => { measure(); }, [measure]);
  useEffect(() => {
    const on = () => measure();
    window.addEventListener("resize", on); window.addEventListener("scroll", on, true);
    return () => { window.removeEventListener("resize", on); window.removeEventListener("scroll", on, true); };
  }, [measure]);

  const finish = async (how: "tour_seen" | "tour_dismissed") => {
    setOpen(false);
    try { await fetch("/api/student/onboarding", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event: how }) }); } catch { /* no bloquea */ }
    onFinish?.();
  };

  if (!open || !step) return null;
  const pad = 8;
  const spot = rect ? { top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 } : null;

  // Tarjeta: debajo del ancla si cabe, si no encima; centrada si no hay ancla.
  const cardW = Math.min(360, (typeof window !== "undefined" ? window.innerWidth : 400) - 32);
  let cardStyle: React.CSSProperties;
  if (spot && typeof window !== "undefined") {
    const below = spot.top + spot.height + 12;
    const fitsBelow = below + 220 < window.innerHeight;
    const top = fitsBelow ? below : Math.max(16, spot.top - 12 - 220);
    const left = Math.min(Math.max(16, spot.left), window.innerWidth - cardW - 16);
    cardStyle = { position: "fixed", top, left, width: cardW };
  } else {
    cardStyle = { position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: cardW };
  }

  return (
    <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-label={step.title}>
      {/* Oscurecido con "agujero" sobre el ancla */}
      {spot ? (
        <div className="absolute rounded-2xl ring-4 ring-brand-400/80 transition-all duration-300"
             style={{ top: spot.top, left: spot.left, width: spot.width, height: spot.height, boxShadow: "0 0 0 9999px rgba(15,23,42,0.62)" }} />
      ) : (
        <div className="absolute inset-0 bg-slate-900/60" />
      )}

      <div style={cardStyle} className="rounded-2xl bg-white dark:bg-slate-900 shadow-2xl border border-slate-200 dark:border-slate-700 p-5">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-brand-600 dark:text-brand-400">{i + 1} {t.of} {steps.length}</span>
          <button type="button" onClick={() => finish("tour_dismissed")} className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">{t.skip}</button>
        </div>
        <h3 className="mt-1 text-lg font-bold text-slate-900 dark:text-slate-50">{step.title}</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-slate-600 dark:text-slate-300">{step.body}</p>
        {step.anchor && !spot && <p className="mt-2 text-xs text-slate-400">{t.inMenu}</p>}
        <div className="mt-4 flex items-center justify-between">
          <div className="flex gap-1">{steps.map((_, k) => <span key={k} className={`h-1.5 w-1.5 rounded-full ${k === i ? "bg-brand-500" : "bg-slate-300 dark:bg-slate-600"}`} />)}</div>
          <div className="flex gap-2">
            {i > 0 && <button type="button" onClick={() => setI(i - 1)} className="rounded-lg px-3 py-1.5 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800">{t.back}</button>}
            {i < steps.length - 1
              ? <button type="button" onClick={() => setI(i + 1)} className="rounded-lg bg-brand-500 hover:bg-brand-600 px-4 py-1.5 text-sm font-semibold text-white">{t.next}</button>
              : <button type="button" onClick={() => finish("tour_seen")} className="rounded-lg bg-emerald-600 hover:bg-emerald-700 px-4 py-1.5 text-sm font-semibold text-white">{t.done}</button>}
          </div>
        </div>
      </div>
    </div>
  );
}
