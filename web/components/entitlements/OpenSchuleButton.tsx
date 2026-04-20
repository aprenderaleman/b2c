"use client";

import { useState, useTransition } from "react";

/**
 * Big "Abrir Schule" card with auto-login. On click, asks the b2c
 * server for an SSO link and redirects. Handles the "not eligible"
 * and "not configured" error paths with a clear message.
 *
 * Rendered inside the student home, replacing the old link-to-schule.
 */
export function OpenSchuleButton() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const openSchule = () => {
    // Open the blank tab SYNCHRONOUSLY inside the click handler so
    // popup blockers don't swallow it. Then kick off the async fetch
    // and point the tab at Schule once the SSO URL arrives. Fallback
    // to same-tab navigation if the popup was blocked.
    const newTab = window.open("about:blank", "_blank", "noopener,noreferrer");

    start(async () => {
      setError(null);
      try {
        const res = await fetch("/api/entitlements/schule-link", { method: "POST" });
        const data = await res.json();
        if (!res.ok || !data?.url) {
          setError(data?.message ?? data?.error ?? "No se pudo abrir Schule.");
          if (newTab && !newTab.closed) newTab.close();
          return;
        }
        if (newTab && !newTab.closed) {
          newTab.location.href = data.url;
        } else {
          window.location.href = data.url;
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error de red.");
        if (newTab && !newTab.closed) newTab.close();
      }
    });
  };

  return (
    <button
      type="button"
      onClick={openSchule}
      disabled={pending}
      className="group relative rounded-3xl
                 bg-gradient-to-br from-brand-50 via-white to-white
                 dark:from-brand-500/15 dark:via-slate-900 dark:to-slate-900
                 border border-brand-200 dark:border-brand-500/30 p-5 block w-full text-left
                 transition-all hover:-translate-y-1 hover:shadow-brand
                 hover:border-brand-400 dark:hover:border-brand-500
                 disabled:opacity-60 disabled:cursor-wait"
    >
      <div className="flex items-start gap-4">
        <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-500 text-white text-2xl shadow-md" aria-hidden>
          🎓
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-50">
              SCHULE
            </h3>
            <span className="text-[10px] font-semibold uppercase tracking-wider rounded-full bg-emerald-100 dark:bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 px-2 py-0.5">
              Incluido
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            Ejercicios auto‑evaluables, audios, gramática y vocabulario.
            Con tu pack tienes acceso total.
          </p>
          {error && (
            <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>
          )}
          <div className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600 dark:text-brand-400">
            {pending ? "Abriendo…" : "Entrar a Schule →"}
          </div>
        </div>
      </div>
    </button>
  );
}
