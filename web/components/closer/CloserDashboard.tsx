"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { TareaCloser } from "@/lib/closer-cadence";

type Props = {
  atrasadas: TareaCloser[];
  hoy: TareaCloser[];
  proximas: TareaCloser[];
};

const CANAL_ICON: Record<string, string> = {
  whatsapp: "WA",
  llamada: "Tel",
  email: "Em",
};

const RESULTADOS = [
  { value: "contactado", label: "Contactado" },
  { value: "no_contesto", label: "No contesto" },
  { value: "no_interesado", label: "No interesado" },
  { value: "reagendado", label: "Reagendado" },
  { value: "venta", label: "Venta!" },
] as const;

export function CloserDashboard({ atrasadas, hoy, proximas }: Props) {
  return (
    <div className="space-y-6">
      {atrasadas.length > 0 && (
        <TaskSection
          title="Atrasadas"
          tasks={atrasadas}
          variant="overdue"
        />
      )}
      <TaskSection
        title={`Hoy (${hoy.length})`}
        tasks={hoy}
        variant="today"
      />
      {proximas.length > 0 && (
        <TaskSection
          title="Proximos 7 dias"
          tasks={proximas}
          variant="upcoming"
        />
      )}
      {atrasadas.length === 0 && hoy.length === 0 && proximas.length === 0 && (
        <div className="rounded-3xl border border-dashed border-slate-200 dark:border-slate-700 p-8 text-center text-slate-500 dark:text-slate-400 text-sm">
          No tienes tareas pendientes. Buen trabajo!
        </div>
      )}
    </div>
  );
}

function TaskSection({
  title,
  tasks,
  variant,
}: {
  title: string;
  tasks: TareaCloser[];
  variant: "overdue" | "today" | "upcoming";
}) {
  const borderColor =
    variant === "overdue"
      ? "border-red-200 dark:border-red-500/30"
      : variant === "today"
        ? "border-slate-200 dark:border-slate-800"
        : "border-slate-100 dark:border-slate-800/60";

  const headerColor =
    variant === "overdue"
      ? "text-red-700 dark:text-red-400"
      : "text-slate-600 dark:text-slate-300";

  return (
    <div className={`rounded-3xl bg-white dark:bg-slate-900 border ${borderColor} p-5`}>
      <h2 className={`text-sm font-semibold uppercase tracking-wide mb-4 ${headerColor}`}>
        {title}
      </h2>
      <div className="space-y-3">
        {tasks.map((task) => (
          <TaskCard key={task.id} task={task} />
        ))}
      </div>
    </div>
  );
}

function TaskCard({ task }: { task: TareaCloser }) {
  const router = useRouter();
  const [showComplete, setShowComplete] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleComplete = (resultado: string) => {
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/closer/tasks/${task.id}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resultado }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.message ?? "Error al completar");
        return;
      }
      setShowComplete(false);
      router.refresh();
    });
  };

  const fecha = new Date(task.fecha_programada);
  const hora = fecha.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
  const dia = fecha.toLocaleDateString("es", { day: "numeric", month: "short" });

  return (
    <div className="flex items-start gap-3 p-3 rounded-2xl border border-slate-100 dark:border-slate-800 hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors">
      <span className="flex-shrink-0 w-10 h-10 rounded-full bg-brand-50 dark:bg-brand-500/10 flex items-center justify-center text-xs font-bold text-brand-700 dark:text-brand-300">
        {CANAL_ICON[task.canal] ?? task.canal}
      </span>

      <div className="flex-1 min-w-0">
        <button
          onClick={() => router.push(`/closer/leads/${task.lead_id}`)}
          className="text-sm font-medium text-slate-900 dark:text-slate-50 hover:text-brand-600 dark:hover:text-brand-400 truncate block text-left"
        >
          {task.lead_name || "Lead"}
        </button>
        <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
          {task.plantilla}
        </p>
        <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
          {dia} {hora} · Paso {task.paso}
        </p>
      </div>

      <div className="flex-shrink-0">
        {!showComplete ? (
          <button
            onClick={() => setShowComplete(true)}
            className="text-xs font-medium rounded-full border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 px-3 py-1 hover:bg-emerald-100 dark:hover:bg-emerald-500/20 transition-colors"
          >
            Completar
          </button>
        ) : (
          <div className="flex flex-wrap gap-1">
            {RESULTADOS.map((r) => (
              <button
                key={r.value}
                disabled={pending}
                onClick={() => handleComplete(r.value)}
                className="text-xs rounded-full border border-slate-200 dark:border-slate-700 px-2 py-0.5 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-50 text-slate-700 dark:text-slate-300"
              >
                {r.label}
              </button>
            ))}
            <button
              onClick={() => setShowComplete(false)}
              className="text-xs text-slate-400 px-1"
            >
              X
            </button>
          </div>
        )}
      </div>

      {error && <p className="text-xs text-red-600 dark:text-red-400 mt-1">{error}</p>}
    </div>
  );
}
