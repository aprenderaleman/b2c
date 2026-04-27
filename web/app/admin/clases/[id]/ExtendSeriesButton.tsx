"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * "Añadir N clases más" button + inline form. Posts to
 * /api/admin/classes/{id}/extend and refreshes the page so the new
 * series_size + future class list reflect the change.
 *
 * Visible on /admin/clases/[id] when the class is part of a recurring
 * series (`seriesSize > 1`).
 */
export function ExtendSeriesButton({
  classId,
  currentSize,
}: {
  classId:     string;
  currentSize: number;
}) {
  const router = useRouter();
  const [open, setOpen]       = useState(false);
  const [count, setCount]     = useState(4);
  const [error, setError]     = useState<string | null>(null);
  const [pending, startTr]    = useTransition();

  const submit = () => {
    setError(null);
    if (!Number.isFinite(count) || count < 1 || count > 52) {
      setError("Indica un número entre 1 y 52.");
      return;
    }
    startTr(async () => {
      const res = await fetch(`/api/admin/classes/${classId}/extend`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ count }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.message ?? data?.error ?? "No se pudo extender la serie.");
        return;
      }
      setOpen(false);
      router.refresh();
    });
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs font-medium rounded-full border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10 px-3 py-1 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-500/20"
        title={`Añadir más clases a la serie (actualmente ${currentSize}).`}
      >
        + Añadir clases
      </button>
    );
  }

  return (
    <div className="inline-flex items-center gap-2 rounded-2xl border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10 px-3 py-2">
      <label className="flex items-center gap-2 text-xs text-emerald-800 dark:text-emerald-200">
        Añadir
        <input
          type="number" min={1} max={52} value={count}
          onChange={(e) => setCount(Number(e.target.value))}
          className="w-16 rounded-lg border border-emerald-300 dark:border-emerald-500/40 bg-white dark:bg-slate-900 px-2 py-1 text-sm"
        />
        clases más
      </label>
      <button
        type="button"
        onClick={submit}
        disabled={pending}
        className="rounded-full bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold px-3 py-1 disabled:opacity-60"
      >
        {pending ? "…" : "Añadir"}
      </button>
      <button
        type="button"
        onClick={() => { setOpen(false); setError(null); }}
        disabled={pending}
        className="text-xs text-emerald-700 dark:text-emerald-300 hover:underline"
      >
        Cancelar
      </button>
      {error && <span className="text-[11px] text-red-600 dark:text-red-400">{error}</span>}
    </div>
  );
}
