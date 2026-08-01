"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { TareaCloser } from "@/lib/closer-cadence";
import { PriorityBadges, summarizeQualification } from "@/components/admin/PriorityBadge";

type Props = {
  atrasadas: TareaCloser[];
  hoy: TareaCloser[];
  proximas: TareaCloser[];
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

const TIPO_LABEL: Record<string, { text: string; cls: string }> = {
  tipo_a: { text: "Tipo A", cls: "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/30" },
  tipo_b: { text: "Tipo B", cls: "bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-500/30" },
  seguimiento_post: { text: "Seguimiento", cls: "bg-slate-50 dark:bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-500/30" },
  llamada_rescate: { text: "Rescate", cls: "bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 border-red-200 dark:border-red-500/30" },
  llamada_objecion: { text: "Objecion", cls: "bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-500/30" },
  seguimiento_absent: { text: "No-show", cls: "bg-orange-50 dark:bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-200 dark:border-orange-500/30" },
  inbound_response: { text: "Inbound", cls: "bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-500/30" },
  reactivacion: { text: "Reactivacion", cls: "bg-purple-50 dark:bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-200 dark:border-purple-500/30" },
};

const CANAL_ICON: Record<string, string> = {
  whatsapp: "WA",
  llamada: "Tel",
  email: "Em",
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

  const tipo = TIPO_LABEL[task.tipo] ?? { text: task.tipo, cls: "bg-slate-50 dark:bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-500/30" };
  const phoneDigits = task.lead_phone?.replace(/\D/g, "") ?? "";
  const qualSummary = summarizeQualification(task.lead_qualification);

  return (
    <div className="rounded-2xl border border-slate-100 dark:border-slate-800 hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors overflow-hidden">
      {/* Main clickable area */}
      <button
        onClick={() => router.push(`/closer/leads/${task.lead_id}`)}
        className="w-full text-left p-3 pb-2"
      >
        <div className="flex items-start gap-3">
          {/* Channel icon */}
          <span
            className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold ${
              task.tipo === "llamada_rescate"
                ? "bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300"
                : task.tipo === "inbound_response"
                  ? "bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300"
                  : "bg-brand-50 dark:bg-brand-500/10 text-brand-700 dark:text-brand-300"
            }`}
          >
            {CANAL_ICON[task.canal] ?? task.canal}
          </span>

          <div className="flex-1 min-w-0">
            {/* Name + badges */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-sm font-semibold text-slate-900 dark:text-slate-50 truncate">
                {task.lead_name || "Lead"}
              </span>
              <span className={`inline-flex items-center rounded-full border px-1.5 py-0 text-[10px] font-semibold uppercase ${tipo.cls}`}>
                {tipo.text}
              </span>
              <PriorityBadges flags={{
                reservaPrioritaria: task.lead_reserva_prioritaria,
                priorityDeadline: task.lead_priority_deadline,
                depositIntentAt: task.lead_deposit_intent_at,
              }} />
              {variant === "overdue" && (
                <span className="text-[10px] font-bold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 rounded-full px-1.5 py-0">
                  -{hoursLate(task.fecha_programada)}
                </span>
              )}
            </div>

            {/* Task description + time */}
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
              {task.plantilla} · {dia} {hora} · Paso {task.paso}
            </p>

            {/* Qualification summary */}
            {qualSummary && (
              <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5 truncate">
                {qualSummary}
              </p>
            )}
          </div>
        </div>
      </button>

      {/* Quick actions bar */}
      <div className="flex items-center gap-2 px-3 pb-2.5 pt-0.5">
        {phoneDigits && (
          <a
            href={`https://wa.me/${phoneDigits}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400 hover:underline"
          >
            WA {task.lead_phone}
          </a>
        )}
        {phoneDigits && (
          <a
            href={`tel:+${phoneDigits}`}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-600 dark:text-blue-400 hover:underline"
          >
            Llamar
          </a>
        )}
        {task.lead_email && (
          <span className="text-[11px] text-slate-400 dark:text-slate-500 truncate max-w-[140px]">
            {task.lead_email}
          </span>
        )}
      </div>
    </div>
  );
}
