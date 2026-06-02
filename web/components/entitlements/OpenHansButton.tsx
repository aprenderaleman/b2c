"use client";

import { useState } from "react";

/**
 * "Abrir Hans" card con SSO. Click → POST /api/entitlements/hans-link
 * → recibe redirectUrl con token de Hans → abre en pestaña nueva.
 *
 * Hans backend vive en hans.aprender-aleman.de/api (NO en el viejo
 * subdominio hans-api.* que dejó de resolver). El endpoint
 * /auth/b2c-sso-link hace upsert del usuario + le pone la suscripción
 * starter, así que esta llamada doble como "sync entitlement".
 *
 * Si el SSO falla (env mal configurado, Hans caído), se hace fallback
 * a abrir hans.aprender-aleman.de directamente — al menos el alumno
 * puede intentar login manual.
 */
export function OpenHansButton() {
  const [busy, setBusy] = useState(false);

  const onClick = async (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);

    try {
      const res = await fetch("/api/entitlements/hans-link", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json().catch(() => ({}));
      const target =
        res.ok && data.ok && typeof data.url === "string"
          ? data.url
          : "https://hans.aprender-aleman.de";
      // Abre en la misma pestaña activa del navegador (no popup) para
      // evitar bloqueos. Equivalente a clicar un link normal.
      window.open(target, "_blank", "noopener,noreferrer");
    } catch {
      window.open("https://hans.aprender-aleman.de", "_blank", "noopener,noreferrer");
    } finally {
      setBusy(false);
    }
  };

  return (
    <a
      href="https://hans.aprender-aleman.de"
      onClick={onClick}
      target="_blank"
      rel="noopener noreferrer"
      className="group relative rounded-3xl
                 bg-gradient-to-br from-brand-50 via-white to-white
                 dark:from-brand-500/15 dark:via-slate-900 dark:to-slate-900
                 border border-brand-200 dark:border-brand-500/30 p-5 block w-full text-left
                 transition-all hover:-translate-y-1 hover:shadow-brand
                 hover:border-brand-400 dark:hover:border-brand-500"
    >
      <div className="flex items-start gap-4">
        <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-500 text-white text-2xl shadow-md" aria-hidden>
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
          <div className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600 dark:text-brand-400">
            {busy ? "Abriendo…" : "Abrir Hans →"}
          </div>
        </div>
      </div>
    </a>
  );
}
