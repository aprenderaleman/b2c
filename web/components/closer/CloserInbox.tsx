"use client";

import { useState, useMemo, useRef, useCallback } from "react";
import type { TareaCloser } from "@/lib/closer-cadence";
import { sortByPriority } from "@/lib/closer-constants";
import { InboxFilterBar } from "./InboxFilterBar";
import { InboxTaskCard } from "./InboxTaskCard";

type Props = {
  tasks: TareaCloser[];
};

type FilterKey = "todos" | "atrasadas" | "hoy" | "inbounds" | "rescates" | "sin_contactar";

const FILTER_DEFS: { key: FilterKey; label: string; test: (t: TareaCloser, todayStart: number, tomorrowStart: number) => boolean }[] = [
  { key: "todos", label: "Todos", test: () => true },
  { key: "atrasadas", label: "Atrasadas", test: (t, todayStart) => new Date(t.fecha_programada).getTime() < todayStart },
  { key: "hoy", label: "Hoy", test: (t, todayStart, tomorrowStart) => { const ts = new Date(t.fecha_programada).getTime(); return ts >= todayStart && ts < tomorrowStart; } },
  { key: "inbounds", label: "Inbounds", test: (t) => t.tipo === "inbound_response" },
  { key: "rescates", label: "Rescates", test: (t) => t.tipo === "llamada_rescate" },
  { key: "sin_contactar", label: "Sin contactar", test: (t) => t.paso === 1 },
];

export function CloserInbox({ tasks: serverTasks }: Props) {
  const [filterKey, setFilterKey] = useState<FilterKey>("todos");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());
  const listRef = useRef<HTMLDivElement>(null);

  const localTasks = useMemo(
    () => serverTasks.filter((t) => !removedIds.has(t.id)),
    [serverTasks, removedIds],
  );

  const now = useMemo(() => {
    const d = new Date();
    const todayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const tomorrowStart = todayStart + 86_400_000;
    return { todayStart, tomorrowStart };
  }, []);

  const filters = useMemo(() => {
    return FILTER_DEFS
      .map((f) => ({
        key: f.key,
        label: f.label,
        count: localTasks.filter((t) => f.test(t, now.todayStart, now.tomorrowStart)).length,
      }))
      .filter((f) => f.key === "todos" || f.count > 0);
  }, [localTasks, now]);

  const activeDef = FILTER_DEFS.find((f) => f.key === filterKey) ?? FILTER_DEFS[0];
  const filteredTasks = useMemo(
    () => sortByPriority(localTasks.filter((t) => activeDef.test(t, now.todayStart, now.tomorrowStart))),
    [localTasks, activeDef, now],
  );

  const handleToggle = useCallback((taskId: string) => {
    setExpandedId((prev) => (prev === taskId ? null : taskId));
  }, []);

  const handleCompleted = useCallback((taskId: string, _remainingTasks: number) => {
    setRemovedIds((prev) => new Set(prev).add(taskId));

    const currentIndex = filteredTasks.findIndex((t) => t.id === taskId);
    const remaining = filteredTasks.filter((t) => t.id !== taskId);

    if (remaining.length > 0) {
      const nextIndex = Math.min(currentIndex, remaining.length - 1);
      const nextTask = remaining[nextIndex];
      setExpandedId(nextTask.id);

      requestAnimationFrame(() => {
        const el = document.getElementById(`inbox-card-${nextTask.id}`);
        el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
    } else {
      setExpandedId(null);
    }
  }, [filteredTasks]);

  const overdueCount = useMemo(
    () => localTasks.filter((t) => new Date(t.fecha_programada).getTime() < now.todayStart).length,
    [localTasks, now],
  );

  return (
    <div className="space-y-4">
      {/* Header with count */}
      <div className="flex items-baseline justify-between gap-2">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">
          Inbox
        </h1>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-slate-500 dark:text-slate-400">
            {localTasks.length} pendientes
          </span>
          {overdueCount > 0 && (
            <span className="font-semibold text-red-600 dark:text-red-400">
              {overdueCount} atrasadas
            </span>
          )}
        </div>
      </div>

      {/* Smart filters */}
      <InboxFilterBar
        filters={filters}
        active={filterKey}
        onChange={(k) => setFilterKey(k as FilterKey)}
      />

      {/* Task list */}
      <div ref={listRef} className="space-y-2">
        {filteredTasks.map((task) => (
          <div key={task.id} id={`inbox-card-${task.id}`}>
            <InboxTaskCard
              task={task}
              expanded={expandedId === task.id}
              onToggle={() => handleToggle(task.id)}
              onCompleted={handleCompleted}
            />
          </div>
        ))}

        {filteredTasks.length === 0 && (
          <div className="rounded-2xl border border-dashed border-slate-200 dark:border-slate-700 p-8 text-center text-slate-500 dark:text-slate-400 text-sm">
            {localTasks.length === 0
              ? "Sin tareas pendientes. Buen trabajo!"
              : "Sin tareas en este filtro."}
          </div>
        )}
      </div>
    </div>
  );
}
