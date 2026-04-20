"use client";

import { useState, useTransition } from "react";

/**
 * "Abrir Hans" card — mirror of OpenSchuleButton but for Hans.
 * Active b2c students get the Starter plan granted automatically.
 */
export function OpenHansButton() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const openHans = () => {
    // Open the blank tab SYNCHRONOUSLY inside the click handler so
    // popup blockers don't swallow it. Then kick off the async fetch
    // and point the tab at Hans once the SSO URL arrives. Fallback
    // to same-tab navigation if the popup was blocked.
    const newTab = window.open("about:blank", "_blank", "noopener,noreferrer");

    start(async () => {
      setError(null);
      try {
        const res = await fetch("/api/entitlements/hans-link", { method: "POST" });
        const data = await res.json();
        if (!res.ok || !data?.url) {
          setError(data?.message ?? data?.error ?? "No se pudo abrir Hans.");
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
      onClick={openHans}
      disabled={pending}
      className="group relative rounded-3xl bg-white dark:bg-slate-900
                 border border-slate-200 dark:border-slate-800 p-5 block w-full text-left
                 transition-all hover:-translate-y-0.5 hover:shadow-brand
                 hover:border-brand-400 dark:hover:border-brand-500
                 disabled:opacity-60 disabled:cursor-wait"
    >
      <div className="flex items-start gap-4">
        <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-50 dark:bg-brand-500/10 text-2xl" aria-hidden>
          🤖
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-50">
              HANS
            </h3>
            <span className="text-[10px] font-semibold uppercase tracking-wider rounded-full bg-emerald-100 dark:bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 px-2 py-0.5">
              Starter · Incluido
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            Tu profesor de IA 24/7 — practica conversación cuando quieras,
            por texto o voz.
          </p>
          {error && (
            <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>
          )}
          <div className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600 dark:text-brand-400">
            {pending ? "Abriendo…" : "Entrar a Hans →"}
          </div>
        </div>
      </div>
    </button>
  );
}
