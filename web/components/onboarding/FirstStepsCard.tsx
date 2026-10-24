"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ChecklistItem } from "@/lib/onboarding";

/**
 * Lista "Primeros pasos" (Gelfis 2026-10-24). Cada punto se tacha solo
 * cuando el sistema detecta la acción. Desaparece al completarse, a los 14
 * días o si el usuario la cierra. Genérica para alumnos y profes.
 */
const T = {
  es: { title: "Primeros pasos", sub: (d: number, n: number) => `${d} de ${n} completados`, close: "Ocultar", tour: "Ver el tour otra vez", allDone: "¡Todo listo! 🎉" },
  de: { title: "Erste Schritte", sub: (d: number, n: number) => `${d} von ${n} erledigt`, close: "Ausblenden", tour: "Tour noch einmal ansehen", allDone: "Alles erledigt! 🎉" },
};

export function FirstStepsCard({ items, lang, tourHref }: { items: ChecklistItem[]; lang: "es" | "de"; tourHref: string }) {
  const router = useRouter();
  const [hidden, setHidden] = useState(false);
  const t = T[lang];
  const done = items.filter(i => i.done).length;
  if (hidden) return null;

  const dismiss = async () => {
    setHidden(true);
    try { await fetch("/api/student/onboarding", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event: "checklist_dismissed" }) }); } catch { /* ignore */ }
    router.refresh();
  };

  return (
    <section data-tour="first-steps" className="rounded-3xl border border-brand-200 dark:border-brand-500/30 bg-brand-50/60 dark:bg-brand-500/10 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wide text-brand-700 dark:text-brand-300">🚀 {t.title}</h2>
          <p className="text-xs text-slate-600 dark:text-slate-300">{done === items.length ? t.allDone : t.sub(done, items.length)}</p>
        </div>
        <button type="button" onClick={dismiss} className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">{t.close}</button>
      </div>
      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/70 dark:bg-slate-800">
        <div className="h-full bg-brand-500 transition-all" style={{ width: `${Math.round((done / items.length) * 100)}%` }} />
      </div>
      <ul className="mt-3 space-y-2">
        {items.map(it => {
          const inner = (
            <>
              <span className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold ${it.done ? "border-emerald-500 bg-emerald-500 text-white" : "border-slate-300 dark:border-slate-600 text-transparent"}`}>✓</span>
              <span className="min-w-0">
                <span className={`block text-sm font-medium ${it.done ? "text-slate-400 line-through" : "text-slate-800 dark:text-slate-100"}`}>{it.label}</span>
                {!it.done && <span className="block text-xs text-slate-500 dark:text-slate-400">{it.hint}</span>}
              </span>
            </>
          );
          const cls = "flex items-start gap-3 rounded-xl px-2 py-1.5 -mx-2 hover:bg-white/70 dark:hover:bg-slate-800/60";
          return (
            <li key={it.key}>
              {it.href && !it.done
                ? <a href={it.href} className={cls} {...(it.href.startsWith("/api/") ? { target: "_blank", rel: "noopener noreferrer" } : {})}>{inner}</a>
                : <div className={cls}>{inner}</div>}
            </li>
          );
        })}
      </ul>
      <div className="mt-3 text-right">
        <a href={tourHref} className="text-xs font-medium text-brand-700 dark:text-brand-300 hover:underline">{t.tour} →</a>
      </div>
    </section>
  );
}
