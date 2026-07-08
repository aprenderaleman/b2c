"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function RefreshRemainingButton({ initial }: { initial: number | null }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [count, setCount] = useState(initial);

  async function handleRefresh() {
    setLoading(true);
    try {
      const res = await fetch("/api/student/classes-remaining");
      if (res.ok) {
        const json = await res.json();
        setCount(json.classes_remaining);
        router.refresh();
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <div className="rounded-2xl border border-brand-200 dark:border-brand-500/30 bg-brand-50 dark:bg-brand-500/10 px-4 py-2.5">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Clases restantes
        </div>
        <div className="mt-0.5 text-2xl font-bold tabular-nums text-brand-700 dark:text-brand-300">
          {count ?? "—"}
        </div>
      </div>
      <button
        onClick={handleRefresh}
        disabled={loading}
        className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 transition-colors"
      >
        <svg
          className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
          />
        </svg>
        {loading ? "Actualizando..." : "Actualizar"}
      </button>
    </div>
  );
}
