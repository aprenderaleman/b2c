"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { TareaCloser } from "@/lib/closer-cadence";
import { PriorityBadges } from "@/components/admin/PriorityBadge";

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

function taskPriorityScore(task: TareaCloser): number {
  if (task.tipo === "llamada_rescate") return 0;
  if (task.lead_reserva_prioritaria || task.lead_priority_deadline === "concrete") return 1;
  if (task.tipo === "llamada_objecion") return 2;
  if (task.prioridad === "alta") return 3;
  return 4;
}

function sortByPriority(tasks: TareaCloser[]): TareaCloser[] {
  return [...tasks].sort((a, b) => {
    const pa = taskPriorityScore(a);
    const pb = taskPriorityScore(b);
    if (pa !== pb) return pa - pb;
    return new Date(a.fecha_programada).getTime() - new Date(b.fecha_programada).getTime();
  });
}

function hoursLate(fechaProgramada: string): string {
  const diff = Date.now() - new Date(fechaProgramada).getTime();
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 1) return "< 1h";
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

const TIPO_LABEL: Record<string, string> = {
  tipo_a: "A",
  tipo_b: "B",
  seguimiento_post: "Seg",
  llamada_rescate: "Rescate",
  llamada_objecion: "Objecion",
  seguimiento_absent: "No-show",
  inbound_response: "Inbound",
  reactivacion: "React",
};

export function CloserDashboard({ atrasadas, hoy, proximas }: Props) {
  const sortedHoy = sortByPriority(hoy);

  return (
    <div className="space-y-6">
      {atrasadas.length > 0 && (
        <TaskSection title="Atrasadas" tasks={atrasadas} variant="overdue" />
      )}
      <TaskSection
        title={`Hoy (${hoy.length})`}
        tasks={sortedHoy}
        variant="today"
      />
      {proximas.length > 0 && (
        <CollapsibleSection
          title={`Proximas (${proximas.length})`}
          tasks={proximas}
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

function CollapsibleSection({ title, tasks }: { title: string; tasks: TareaCloser[] }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800/60 p-5">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300"
      >
        <span>{title}</span>
        <svg
          className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="space-y-3 mt-4">
          {tasks.map((task) => (
            <TaskCard key={task.id} task={task} variant="upcoming" />
          ))}
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
      : "border-slate-200 dark:border-slate-800";

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
          <TaskCard key={task.id} task={task} variant={variant} />
        ))}
        {tasks.length === 0 && variant === "today" && (
          <p className="text-sm text-slate-400 dark:text-slate-500 text-center py-4">
            Sin tareas para hoy.
          </p>
        )}
      </div>
    </div>
  );
}

function TaskCard({ task, variant }: { task: TareaCloser; variant: "overdue" | "today" | "upcoming" }) {
  const router = useRouter();

  const fecha = new Date(task.fecha_programada);
  const hora = fecha.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
  const dia = fecha.toLocaleDateString("es", { day: "numeric", month: "short" });

  const tipoLabel = TIPO_LABEL[task.tipo] ?? task.tipo;
  const isRescate = task.tipo === "llamada_rescate";
  const isObjecion = task.tipo === "llamada_objecion";

  return (
    <button
      onClick={() => router.push(`/closer/leads/${task.lead_id}`)}
      className="w-full text-left flex items-start gap-3 p-3 rounded-2xl border border-slate-100 dark:border-slate-800 hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors"
    >
      <span
        className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold ${
          isRescate
            ? "bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300"
            : "bg-brand-50 dark:bg-brand-500/10 text-brand-700 dark:text-brand-300"
        }`}
      >
        {CANAL_ICON[task.canal] ?? task.canal}
      </span>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-sm font-medium text-slate-900 dark:text-slate-50 truncate">
            {task.lead_name || "Lead"}
          </span>
          <PriorityBadges flags={{
            reservaPrioritaria: task.lead_reserva_prioritaria,
            priorityDeadline: task.lead_priority_deadline,
            depositIntentAt: task.lead_deposit_intent_at,
          }} />
        </div>

        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
          <span
            className={`inline-flex items-center rounded-full border px-1.5 py-0 text-[10px] font-semibold uppercase ${
              isRescate
                ? "bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 border-red-200 dark:border-red-500/30"
                : isObjecion
                  ? "bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-500/30"
                  : "bg-slate-50 dark:bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-500/30"
            }`}
          >
            {tipoLabel}
          </span>
          <span className="text-xs text-slate-500 dark:text-slate-400 truncate">
            {task.plantilla}
          </span>
        </div>

        <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
          {dia} {hora} · Paso {task.paso}
        </p>
      </div>

      {variant === "overdue" && (
        <span className="flex-shrink-0 text-xs font-semibold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 rounded-full px-2 py-0.5">
          -{hoursLate(task.fecha_programada)}
        </span>
      )}
    </button>
  );
}
