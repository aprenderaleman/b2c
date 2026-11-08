"use client";

import { useState } from "react";

export type MaterialItem = {
  id: string;
  title: string;
  file_name: string | null;
  size_mb: string | null;
};

export type MaterialLevel = {
  level: string;
  label: string;
  items: MaterialItem[];
};

/**
 * Materiales de los cursos en PDF, lección por lección (Gelfis
 * 2026-11-08). Acordeón por nivel; cada lección tiene su botón
 * "Descargar PDF" que pasa por /api/profesor/recursos/{id}/open con
 * download=1 (URL firmada con Content-Disposition: attachment).
 */
export function CursosMateriales({ levels }: { levels: MaterialLevel[] }) {
  const [open, setOpen] = useState<string | null>(levels[0]?.level ?? null);
  const [busy, setBusy] = useState<string | null>(null);

  async function download(id: string) {
    setBusy(id);
    try {
      const r = await fetch(`/api/profesor/recursos/${id}/open?download=1`);
      const j = await r.json();
      if (!r.ok || !j.url) {
        alert(j.message ?? j.error ?? "No se pudo descargar el material");
        return;
      }
      // La URL firmada lleva attachment → el navegador descarga sin
      // navegar fuera de la página.
      window.location.href = j.url;
    } finally {
      setBusy(null);
    }
  }

  if (levels.length === 0) return null;

  return (
    <section className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6">
      <header>
        <h2 className="text-lg font-bold text-slate-900 dark:text-slate-50">
          📄 Materiales en PDF
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Descarga las lecciones de cada nivel para estudiar sin conexión o imprimirlas.
        </p>
      </header>

      <div className="mt-4 space-y-2">
        {levels.map((lvl) => {
          const isOpen = open === lvl.level;
          return (
            <div
              key={lvl.level}
              className="rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden"
            >
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : lvl.level)}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left bg-slate-50 dark:bg-slate-800/60 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                aria-expanded={isOpen}
              >
                <span className="flex items-center gap-2">
                  <span className="inline-flex items-center rounded-full bg-brand-600/10 text-brand-700 dark:text-brand-300 px-2.5 py-0.5 text-xs font-bold">
                    {lvl.level}
                  </span>
                  <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {lvl.label}
                  </span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    · {lvl.items.length} lecciones
                  </span>
                </span>
                <span
                  aria-hidden
                  className={`text-slate-400 transition-transform ${isOpen ? "rotate-180" : ""}`}
                >
                  ▾
                </span>
              </button>

              {isOpen && (
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                  {lvl.items.map((m) => (
                    <li
                      key={m.id}
                      className="flex items-center justify-between gap-3 px-4 py-2.5"
                    >
                      <span className="min-w-0">
                        <span className="block text-sm text-slate-800 dark:text-slate-200 truncate">
                          {m.title}
                        </span>
                        {m.size_mb && (
                          <span className="block text-[11px] text-slate-400 dark:text-slate-500">
                            PDF · {m.size_mb} MB
                          </span>
                        )}
                      </span>
                      <button
                        type="button"
                        onClick={() => download(m.id)}
                        disabled={busy === m.id}
                        className="btn-secondary text-xs px-3 py-1.5 shrink-0 disabled:opacity-60"
                      >
                        {busy === m.id ? "Preparando…" : "⬇ Descargar PDF"}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
