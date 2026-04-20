"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type Outcome = "fixed" | "failed" | "pending" | "not_found" | "error";
type Result = {
  ok:      boolean;
  summary: { checked: number; fixed: number; failed: number; pending: number; errors: number };
  results: Array<{
    egress_id:   string;
    outcome:     Outcome;
    file_url?:   string | null;
    size_mb?:    number | null;
    duration_s?: number | null;
    error?:      string | null;
  }>;
};

/**
 * One-click button that walks every recording in status='processing',
 * asks LiveKit for the real state, and flips rows to 'ready' or
 * 'failed' accordingly. Shows a per-recording breakdown after.
 */
export function ReconcileRecordingsButton({ initialCount }: { initialCount: number }) {
  const router = useRouter();
  const [pending, start]   = useTransition();
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError]   = useState<string | null>(null);

  const run = () => {
    setError(null);
    start(async () => {
      try {
        const res = await fetch("/api/admin/recordings/reconcile", { method: "POST" });
        const data = await res.json();
        if (!res.ok) {
          setError(data?.message ?? data?.error ?? "Error al reconciliar.");
          return;
        }
        setResult(data as Result);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error de red.");
      }
    });
  };

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={run}
        disabled={pending || initialCount === 0}
        className="inline-flex items-center gap-2 rounded-2xl bg-brand-500 hover:bg-brand-600
                   text-white text-sm font-semibold px-5 py-3 shadow
                   disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
      >
        {pending ? "Reconciliando…" :
         initialCount === 0 ? "Nada que reconciliar" :
                             `Rescatar ${initialCount} grabación${initialCount === 1 ? "" : "es"}`}
      </button>

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>
      )}

      {result && (
        <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/60 p-4 text-xs">
          <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
            {result.summary.fixed} marcadas como listas
            {result.summary.failed > 0 && <> · <span className="text-red-600 dark:text-red-400">{result.summary.failed} con error</span></>}
            {result.summary.pending > 0 && <> · <span className="text-amber-600 dark:text-amber-400">{result.summary.pending} aún en curso</span></>}
          </p>
          <ul className="mt-3 space-y-1.5">
            {result.results.map(r => (
              <li key={r.egress_id} className="flex items-center justify-between gap-3">
                <span className="text-slate-700 dark:text-slate-200">
                  {r.outcome === "fixed"     ? "✓" :
                   r.outcome === "pending"   ? "⏳" :
                   r.outcome === "error"     ? "⚠️" :
                                               "✗"} {" "}
                  <code className="font-mono">{r.egress_id}</code>
                </span>
                <span className="font-mono text-slate-500 dark:text-slate-400 truncate">
                  {r.outcome === "fixed"    ? `${r.size_mb ?? "?"} MB · ${r.duration_s ?? "?"}s` :
                   r.outcome === "pending"  ? "todavía grabando" :
                   r.outcome === "not_found"? "no existe en LiveKit" :
                   r.outcome === "error"    ? r.error ?? "error" :
                                               r.error ?? "sin archivo"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
