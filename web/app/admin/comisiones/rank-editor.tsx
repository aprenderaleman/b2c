"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

const RANKS = [
  { value: "starter", label: "🌱 Starter (5%)" },
  { value: "pro",     label: "⭐ Pro (10%)" },
  { value: "elite",   label: "🔥 Elite (12%)" },
  { value: "master",  label: "👑 Master (15%)" },
];

/**
 * Rango + comisión acordada de un profe (/admin/comisiones).
 *
 * El rango fija el % por defecto. "Acordado" es un número libre
 * (2026-11-26): si se rellena, manda sobre el rango; si se deja vacío y se
 * guarda, el profe vuelve a cobrar según su rango.
 */
export function RankEditor({ teacherId, currentRank, customPct }: { teacherId: string; currentRank: string; customPct: number | null }) {
  const router = useRouter();
  const [rank, setRank] = useState(currentRank);
  const [pct, setPct] = useState(customPct != null ? String(customPct) : "");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const patch = (body: Record<string, unknown>) => {
    setSaved(false); setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/admin/teachers/${teacherId}/rank`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok) { setSaved(true); router.refresh(); }
      else setError(j.error ?? `HTTP ${res.status}`);
    });
  };

  const handleRank = (newRank: string) => { setRank(newRank); patch({ rango: newRank }); };

  const pctTrim = pct.trim();
  const pctNum = Number(pctTrim.replace(",", "."));
  const pctValid = pctTrim === "" || (Number.isFinite(pctNum) && pctNum >= 0 && pctNum <= 100);
  const pctChanged = pctTrim === "" ? customPct != null : pctNum !== customPct;
  const savePct = () => { if (pctValid && pctChanged) patch({ comision_pct: pctTrim === "" ? null : pctNum }); };

  const inputCls = "rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1 text-xs text-slate-900 dark:text-slate-100";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select value={rank} onChange={e => handleRank(e.target.value)} disabled={pending} className={inputCls} aria-label="Rango">
        {RANKS.map(r => (
          <option key={r.value} value={r.value}>{r.label}</option>
        ))}
      </select>
      <label className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
        Acordado
        <input
          type="number" min="0" max="100" step="0.5" inputMode="decimal"
          value={pct} onChange={e => { setPct(e.target.value); setSaved(false); }}
          onKeyDown={e => { if (e.key === "Enter") savePct(); }}
          placeholder="—" disabled={pending}
          className={`${inputCls} w-16 tabular-nums`}
          aria-label="Comisión acordada en porcentaje"
        />
        %
      </label>
      {pctChanged && pctValid && (
        <button type="button" onClick={savePct} disabled={pending}
          className="rounded-lg border border-emerald-300 dark:border-emerald-500/40 px-2 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-500/10">
          {pctTrim === "" ? "Quitar" : "Guardar"}
        </button>
      )}
      {!pctValid && <span className="text-xs text-red-500">0–100</span>}
      {pending && <span className="text-xs text-slate-400">...</span>}
      {saved && !pending && <span className="text-xs text-emerald-500">OK</span>}
      {error && <span className="text-xs text-red-500" role="alert">{error}</span>}
    </div>
  );
}
