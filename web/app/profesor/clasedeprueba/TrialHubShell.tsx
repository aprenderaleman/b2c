"use client";

import { useState, useMemo } from "react";
import type { TrialClassRow } from "@/lib/trial-classes";
import { TrialHubList } from "./TrialHubList";

type Tab = "upcoming" | "history";

export function TrialHubShell({
  upcoming,
  past,
  studentMap,
  isAdmin = false,
  canDelete = false,
}: {
  upcoming: TrialClassRow[];
  past: TrialClassRow[];
  studentMap: Record<string, string>;
  isAdmin?: boolean;
  canDelete?: boolean;
}) {
  const [tab, setTab] = useState<Tab>("upcoming");
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();

  const filtered = useMemo(() => {
    const source = tab === "upcoming" ? upcoming : past;
    if (!q) return source;
    return source.filter((r) => {
      const haystack = [
        r.leadName,
        r.leadEmail,
        r.leadWhatsapp,
        r.leadGoal,
        r.leadGermanLevel,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [tab, q, upcoming, past]);

  const counts = { upcoming: upcoming.length, history: past.length };

  return (
    <div className="space-y-4">
      {/* Search + tabs */}
      <div className="flex flex-col sm:flex-row gap-3">
        {/* Search */}
        <div className="relative flex-1">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
            🔍
          </span>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nombre, email, telefono..."
            className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 pl-9 pr-3 py-2.5 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-400 dark:focus:ring-sky-500"
          />
          {q && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-sm"
            >
              ✕
            </button>
          )}
        </div>

        {/* Tabs */}
        <div className="flex rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden shrink-0">
          <TabButton
            active={tab === "upcoming"}
            onClick={() => setTab("upcoming")}
            label="Siguientes"
            count={counts.upcoming}
          />
          <TabButton
            active={tab === "history"}
            onClick={() => setTab("history")}
            label="Historial"
            count={counts.history}
          />
        </div>
      </div>

      {/* Results */}
      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 dark:border-slate-700 bg-white/40 dark:bg-slate-900/40 p-6 text-sm text-slate-500 dark:text-slate-400 text-center">
          {q
            ? `No se encontraron resultados para "${query.trim()}".`
            : tab === "upcoming"
              ? "No tienes clases de prueba agendadas."
              : "Aun no tienes clases de prueba pasadas."}
        </div>
      ) : (
        <>
          {q && (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {filtered.length} resultado{filtered.length !== 1 ? "s" : ""}
            </p>
          )}
          <TrialHubList
            rows={filtered}
            studentMap={studentMap}
            isAdmin={isAdmin}
            canDelete={canDelete}
          />
        </>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-2.5 text-sm font-semibold transition-colors ${
        active
          ? "bg-sky-50 dark:bg-sky-500/15 text-sky-700 dark:text-sky-200"
          : "text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800"
      }`}
    >
      {label}
      <span className={`ml-1.5 text-xs font-normal ${
        active ? "text-sky-500 dark:text-sky-400" : "text-slate-400 dark:text-slate-500"
      }`}>
        {count}
      </span>
    </button>
  );
}
