"use client";

import { useState, useTransition } from "react";

type SendResult = {
  ok:      boolean;
  sent:    number;
  failed:  number;
  results: Array<{
    name:       string;
    email:      string;
    ok:         boolean;
    error?:     string;
    message_id?: string | null;
  }>;
};

/**
 * Confirm-and-send button for the teachers platform-ready broadcast.
 * Shows per-recipient result so the admin can see which email went
 * through (message_id) and which errored.
 */
export function BroadcastTrigger({ count }: { count: number }) {
  const [pending, start]   = useTransition();
  const [result, setResult] = useState<SendResult | null>(null);
  const [error, setError]   = useState<string | null>(null);

  const send = () => {
    setError(null);
    if (!confirm(`¿Enviar el anuncio a ${count} profesor${count === 1 ? "" : "es"}? No se puede deshacer.`)) return;

    start(async () => {
      try {
        const res = await fetch("/api/admin/broadcast/teachers-platform-ready", {
          method: "POST",
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data?.message ?? data?.error ?? "Error al enviar.");
          return;
        }
        setResult(data as SendResult);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error de red.");
      }
    });
  };

  return (
    <section className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
            Enviar broadcast
          </h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Un solo clic envía el email a todos los profesores activos. Se pedirá confirmación.
          </p>
        </div>
        <button
          type="button"
          onClick={send}
          disabled={pending || count === 0 || Boolean(result)}
          className="inline-flex items-center gap-2 rounded-2xl bg-brand-500 hover:bg-brand-600
                     text-white text-sm font-semibold px-5 py-3 shadow
                     disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
        >
          {pending ? "Enviando…" :
           result  ? `✓ Enviado (${result.sent}/${result.sent + result.failed})` :
                    `Enviar a los ${count} profesor${count === 1 ? "" : "es"}`}
        </button>
      </div>

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      )}

      {result && (
        <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/60 p-4">
          <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
            {result.sent} enviado{result.sent === 1 ? "" : "s"}
            {result.failed > 0 && <span className="text-red-600 dark:text-red-400"> · {result.failed} con error</span>}
          </p>
          <ul className="mt-3 space-y-1.5 text-xs">
            {result.results.map(r => (
              <li key={r.email} className="flex items-center justify-between gap-3">
                <span className="text-slate-700 dark:text-slate-200">
                  {r.ok ? "✓" : "✗"} {r.name || r.email}
                </span>
                <span className="font-mono text-slate-500 dark:text-slate-400 truncate">
                  {r.ok ? (r.message_id ?? "(sin id — modo dev)") : r.error}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
