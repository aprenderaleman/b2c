"use client";

import { useState, useTransition } from "react";

const RANKS = [
  { value: "starter", label: "🌱 Starter (5%)" },
  { value: "pro",     label: "⭐ Pro (8%)" },
  { value: "elite",   label: "🔥 Elite (12%)" },
  { value: "master",  label: "👑 Master (15%)" },
];

export function RankEditor({ teacherId, currentRank }: { teacherId: string; currentRank: string }) {
  const [rank, setRank] = useState(currentRank);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const handleChange = (newRank: string) => {
    setRank(newRank);
    setSaved(false);
    startTransition(async () => {
      const res = await fetch(`/api/admin/teachers/${teacherId}/rank`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rango: newRank }),
      });
      if (res.ok) setSaved(true);
    });
  };

  return (
    <div className="flex items-center gap-2">
      <select
        value={rank}
        onChange={e => handleChange(e.target.value)}
        disabled={pending}
        className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1 text-xs text-slate-900 dark:text-slate-100"
      >
        {RANKS.map(r => (
          <option key={r.value} value={r.value}>{r.label}</option>
        ))}
      </select>
      {pending && <span className="text-xs text-slate-400">...</span>}
      {saved && !pending && <span className="text-xs text-emerald-500">OK</span>}
    </div>
  );
}
