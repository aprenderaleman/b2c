"use client";

import { useState } from "react";
import { LEVEL_PRESENTATION_URL, LEVEL_OPTIONS, type LevelBucket } from "@/lib/trial-presentations";

export function PresentationLinks({ defaultLevel }: { defaultLevel?: string }) {
  const initial = LEVEL_OPTIONS.includes(defaultLevel as LevelBucket)
    ? (defaultLevel as LevelBucket)
    : "A1";
  const [level, setLevel] = useState<LevelBucket>(initial);

  return (
    <div className="flex items-center gap-2">
      <select
        value={level}
        onChange={(e) => setLevel(e.target.value as LevelBucket)}
        className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-400"
      >
        {LEVEL_OPTIONS.map((l) => (
          <option key={l} value={l}>{l}</option>
        ))}
      </select>
      <a
        href={LEVEL_PRESENTATION_URL[level]}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 rounded-lg border border-purple-300 dark:border-purple-500/40 bg-purple-50 dark:bg-purple-500/10 px-3 py-1.5 text-xs font-semibold text-purple-800 dark:text-purple-200 hover:bg-purple-100 dark:hover:bg-purple-500/20 transition-colors"
      >
        Abrir presentacion
      </a>
    </div>
  );
}
