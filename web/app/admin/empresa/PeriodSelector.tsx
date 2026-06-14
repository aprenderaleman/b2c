"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";

const PRESETS = [
  { key: "7d",         label: "7 dias" },
  { key: "30d",        label: "30 dias" },
  { key: "month",      label: "Este mes" },
  { key: "prev_month", label: "Mes anterior" },
  { key: "custom",     label: "Personalizado" },
] as const;

export function PeriodSelector({ current }: { current: string }) {
  const router = useRouter();
  const sp = useSearchParams();
  const [showCustom, setShowCustom] = useState(current === "custom");
  const [customFrom, setCustomFrom] = useState(sp.get("from") ?? "");
  const [customTo, setCustomTo] = useState(sp.get("to") ?? "");

  const select = useCallback((key: string) => {
    if (key === "custom") {
      setShowCustom(true);
      return;
    }
    setShowCustom(false);
    const params = new URLSearchParams();
    params.set("period", key);
    router.push(`/admin/empresa?${params.toString()}`);
  }, [router]);

  const applyCustom = useCallback(() => {
    if (!customFrom || !customTo) return;
    const params = new URLSearchParams();
    params.set("period", "custom");
    params.set("from", customFrom);
    params.set("to", customTo);
    router.push(`/admin/empresa?${params.toString()}`);
  }, [router, customFrom, customTo]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {PRESETS.map(p => (
        <button
          key={p.key}
          onClick={() => select(p.key)}
          className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
            current === p.key
              ? "bg-brand-600 text-white"
              : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
          }`}
        >
          {p.label}
        </button>
      ))}
      {showCustom && (
        <div className="flex items-center gap-2 ml-2">
          <input
            type="date"
            value={customFrom}
            onChange={e => setCustomFrom(e.target.value)}
            className="input-text text-xs px-2 py-1"
          />
          <span className="text-slate-400">—</span>
          <input
            type="date"
            value={customTo}
            onChange={e => setCustomTo(e.target.value)}
            className="input-text text-xs px-2 py-1"
          />
          <button
            onClick={applyCustom}
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-brand-600 text-white hover:bg-brand-700"
          >
            Aplicar
          </button>
        </div>
      )}
    </div>
  );
}
