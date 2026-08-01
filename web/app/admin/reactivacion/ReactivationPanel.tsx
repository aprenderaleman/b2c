"use client";

import { useState } from "react";

type Props = {
  closers: Array<{ id: string; full_name: string | null }>;
  pendingCount: number;
};

export function ReactivationPanel({ closers, pendingCount }: Props) {
  const [closerId, setCloserId] = useState(closers[0]?.id ?? "");
  const [maxLeads, setMaxLeads] = useState(30);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    assigned: number;
    skipped: number;
    total_candidates: number;
  } | null>(null);

  async function handleLaunch() {
    if (!closerId) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/reactivation/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ closer_id: closerId, max_leads: maxLeads }),
      });
      const data = await res.json();
      if (res.ok) {
        setResult(data);
      } else {
        alert(`Error: ${data.error ?? "unknown"}`);
      }
    } catch (err) {
      alert("Error de red");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 space-y-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
        Lanzar reactivacion
      </h2>

      <p className="text-sm text-slate-500 dark:text-slate-400">
        {pendingCount} leads elegibles (perdidos/en reactivacion, ultimos 90 dias, sin batch previo).
      </p>

      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
            Closer
          </label>
          <select
            value={closerId}
            onChange={(e) => setCloserId(e.target.value)}
            className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
          >
            {closers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.full_name ?? c.id.slice(0, 8)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
            Max leads
          </label>
          <input
            type="number"
            min={1}
            max={200}
            value={maxLeads}
            onChange={(e) => setMaxLeads(Number(e.target.value))}
            className="w-20 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
          />
        </div>

        <button
          onClick={handleLaunch}
          disabled={loading || closers.length === 0}
          className="rounded-xl bg-brand-600 hover:bg-brand-700 disabled:opacity-50 px-5 py-2 text-sm font-medium text-white transition-colors"
        >
          {loading ? "Procesando..." : "Lanzar batch"}
        </button>
      </div>

      {result && (
        <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-500/10 p-4 text-sm">
          <p className="font-medium text-emerald-800 dark:text-emerald-300">
            Batch completado
          </p>
          <ul className="mt-1 space-y-0.5 text-emerald-700 dark:text-emerald-400">
            <li>Candidatos evaluados: {result.total_candidates}</li>
            <li>Asignados y cadena iniciada: {result.assigned}</li>
            <li>Omitidos (cadena activa): {result.skipped}</li>
          </ul>
        </div>
      )}
    </section>
  );
}
