"use client";

import { useState, useTransition, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import type { TareaCloser } from "@/lib/closer-cadence";
import { TIPO_LABEL, CANAL_ICON, TASK_TO_TEMPLATE_ACTION, SOURCE_META, hoursLate, timeSince, fmtTrialDate } from "@/lib/closer-constants";
import { PriorityBadges, summarizeQualification } from "@/components/admin/PriorityBadge";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { CopyMessagePanel } from "./CopyMessagePanel";
import { MarkSaleModal } from "./MarkSaleModal";
import { NextActionPrompt } from "./NextActionPrompt";

type Props = {
  task: TareaCloser;
  expanded: boolean;
  onToggle: () => void;
  onCompleted: (taskId: string, remainingTasks: number) => void;
};

type ResultScreen = "buttons" | "contactado" | "no_interesado";

type LeadContext = {
  teacherNote: { content: string; created_at: string } | null;
  qualification: { goal?: string; level?: string; deadline?: string } | null;
  lastContact: string | null;
} | null;

const OBJECTION_CHIPS = [
  { value: "precio", label: "Precio" },
  { value: "pensarlo", label: "Pensarlo" },
  { value: "pareja", label: "Pareja/familia" },
  { value: "tiempo", label: "Tiempo" },
  { value: "otra", label: "Otra" },
] as const;

const MOTIVOS = [
  { value: "Se enfrio", label: "Se enfrio" },
  { value: "Sin dinero", label: "Sin dinero" },
  { value: "Eligio otra academia", label: "Eligio otra" },
  { value: "Otro", label: "Otro" },
] as const;

function urgencyClass(task: TareaCloser): string {
  const now = Date.now();
  const scheduled = new Date(task.fecha_programada).getTime();
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const tomorrowStart = new Date(todayStart); tomorrowStart.setDate(tomorrowStart.getDate() + 1);

  if (scheduled < todayStart.getTime()) return "border-l-red-500";
  if (scheduled < tomorrowStart.getTime()) return "border-l-amber-400";
  return "border-l-slate-300 dark:border-l-slate-600";
}

export function InboxTaskCard({ task, expanded, onToggle, onCompleted }: Props) {
  const router = useRouter();
  const cardRef = useRef<HTMLDivElement>(null);
  const [pending, startTransition] = useTransition();

  // Expanded state
  const [context, setContext] = useState<LeadContext>(null);
  const [contextLoading, setContextLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageLoading, setMessageLoading] = useState(false);
  const [resultScreen, setResultScreen] = useState<ResultScreen>("buttons");
  const [objectionChip, setObjectionChip] = useState<string | null>(null);
  const [motivo, setMotivo] = useState<string | null>(null);
  const [nota, setNota] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showSaleModal, setShowSaleModal] = useState(false);
  const [showNextPrompt, setShowNextPrompt] = useState(false);

  const tipo = TIPO_LABEL[task.tipo] ?? { text: task.tipo, cls: "bg-slate-50 dark:bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-500/30" };
  const phoneDigits = task.lead_phone?.replace(/\D/g, "") ?? "";
  const qualSummary = summarizeQualification(task.lead_qualification);
  const templateAction = TASK_TO_TEMPLATE_ACTION[task.tipo];
  const isFirstContact = task.paso === 1;

  const fetchContext = useCallback(async () => {
    setContextLoading(true);
    try {
      const res = await fetch(`/api/closer/leads/${task.lead_id}/context`);
      if (res.ok) setContext(await res.json());
    } finally {
      setContextLoading(false);
    }
  }, [task.lead_id]);

  const fetchMessage = useCallback(async () => {
    if (!templateAction) return;
    setMessageLoading(true);
    try {
      const res = await fetch(`/api/closer/leads/${task.lead_id}/layer2`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: templateAction, preview: true }),
      });
      if (res.ok) {
        const data = await res.json();
        setMessage(data.message ?? null);
      }
    } finally {
      setMessageLoading(false);
    }
  }, [task.lead_id, templateAction]);

  useEffect(() => {
    if (expanded) {
      fetchContext();
      fetchMessage();
      setResultScreen("buttons");
      setObjectionChip(null);
      setMotivo(null);
      setNota("");
      setError(null);
      setShowNextPrompt(false);
    }
  }, [expanded, fetchContext, fetchMessage]);

  const completeTask = (resultado: string, extras?: { objectionChip?: string; motivoNoInteresado?: string }) => {
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/closer/tasks/${task.id}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resultado, notas: nota || undefined, ...extras }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.error ?? "Error al completar");
        return;
      }
      const data = await res.json();
      const remaining = data.remainingTasks ?? 0;

      if (remaining === 0) {
        setShowNextPrompt(true);
      } else {
        onCompleted(task.id, remaining);
        router.refresh();
      }
    });
  };

  const executeLayer2 = () => {
    if (!templateAction) return;
    startTransition(async () => {
      await fetch(`/api/closer/leads/${task.lead_id}/layer2`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: templateAction }),
      });
      router.refresh();
    });
  };

  const fecha = new Date(task.fecha_programada);
  const hora = fecha.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
  const dia = fecha.toLocaleDateString("es", { day: "numeric", month: "short" });
  const isOverdue = fecha.getTime() < Date.now();

  if (showNextPrompt) {
    return (
      <div ref={cardRef}>
        <NextActionPrompt
          leadId={task.lead_id}
          leadName={task.lead_name || "Lead"}
          onDismiss={() => {
            setShowNextPrompt(false);
            onCompleted(task.id, 0);
            router.refresh();
          }}
        />
      </div>
    );
  }

  return (
    <div
      ref={cardRef}
      className={`rounded-2xl border border-slate-100 dark:border-slate-800 border-l-4 ${urgencyClass(task)} bg-white dark:bg-slate-900 transition-all ${expanded ? "shadow-md ring-1 ring-brand-500/20" : "hover:bg-slate-50/60 dark:hover:bg-slate-800/40"}`}
    >
      {/* ── Collapsed header (always visible) ── */}
      <div
        onClick={onToggle}
        className="cursor-pointer p-3"
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } }}
      >
        <div className="flex items-start gap-3">
          <span
            className={`flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold ${
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
              {isOverdue && (
                <span className="text-[10px] font-bold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 rounded-full px-1.5 py-0">
                  -{hoursLate(task.fecha_programada)}
                </span>
              )}
            </div>

            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
              {task.plantilla} · {dia} {hora} · Paso {task.paso}
            </p>

            {qualSummary && (
              <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5 truncate">
                {qualSummary}
              </p>
            )}

            {isFirstContact && task.lead_created_at && (
              <p className="text-[10px] font-medium text-red-500 dark:text-red-400 mt-0.5">
                Sin contactar · desde hace {timeSince(task.lead_created_at)}
              </p>
            )}

            {/* Source + trial + pipeline badges */}
            <div className="flex items-center gap-1.5 flex-wrap mt-1">
              {(() => {
                const sm = SOURCE_META[task.lead_landing_intent ?? "(sin landing)"] ?? SOURCE_META["(sin landing)"];
                return (
                  <span className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0 text-[9px] font-semibold border ${sm.sourceCls}`}>
                    {sm.sourceIcon} {sm.sourceLabel}
                  </span>
                );
              })()}
              {task.lead_trial_scheduled_at && (
                <span className="text-[9px] text-slate-500 dark:text-slate-400">
                  🗓 {fmtTrialDate(task.lead_trial_scheduled_at)}
                  {task.lead_trial_attended_at && <span className="ml-0.5 text-emerald-600 dark:text-emerald-400">✓</span>}
                  {task.lead_trial_absent_at && <span className="ml-0.5 text-red-600 dark:text-red-400">✗</span>}
                </span>
              )}
              {task.lead_status && <StatusBadge status={task.lead_status} />}
            </div>
          </div>

          <svg
            className={`w-4 h-4 text-slate-400 transition-transform flex-shrink-0 mt-1 ${expanded ? "rotate-180" : ""}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>

        {/* Quick links — always visible */}
        <div className="flex items-center gap-2 mt-1.5 ml-12">
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

      {/* ── Expanded panel ── */}
      {expanded && (
        <div className="border-t border-slate-100 dark:border-slate-800 px-3 pb-3 pt-3 space-y-3">
          {/* Context strip */}
          {contextLoading && (
            <p className="text-xs text-slate-400 animate-pulse">Cargando contexto...</p>
          )}
          {context && (
            <div className="rounded-xl bg-blue-50/60 dark:bg-blue-500/5 border border-blue-100 dark:border-blue-500/20 p-3 space-y-2">
              {context.qualification && (
                <div className="flex gap-4 text-xs">
                  {context.qualification.goal && (
                    <div>
                      <span className="text-[10px] uppercase text-slate-500 dark:text-slate-400">Meta</span>
                      <p className="font-medium text-slate-700 dark:text-slate-300">{context.qualification.goal}</p>
                    </div>
                  )}
                  {context.qualification.level && (
                    <div>
                      <span className="text-[10px] uppercase text-slate-500 dark:text-slate-400">Nivel</span>
                      <p className="font-medium text-slate-700 dark:text-slate-300">{context.qualification.level}</p>
                    </div>
                  )}
                  {context.qualification.deadline && (
                    <div>
                      <span className="text-[10px] uppercase text-slate-500 dark:text-slate-400">Plazo</span>
                      <p className="font-medium text-slate-700 dark:text-slate-300">{context.qualification.deadline}</p>
                    </div>
                  )}
                </div>
              )}
              {context.teacherNote && (
                <div className="border-t border-blue-100 dark:border-blue-500/10 pt-2">
                  <p className="text-[10px] uppercase text-slate-500 dark:text-slate-400">Nota del profe</p>
                  <p className="text-xs text-slate-600 dark:text-slate-300 italic mt-0.5">
                    &ldquo;{context.teacherNote.content}&rdquo;
                  </p>
                </div>
              )}
              {context.lastContact && (
                <p className="text-[10px] text-slate-400 dark:text-slate-500">
                  Ultimo contacto: hace {timeSince(context.lastContact)}
                </p>
              )}
            </div>
          )}

          {/* Resolved message panel */}
          {templateAction && messageLoading && (
            <p className="text-xs text-slate-400 animate-pulse text-center py-2">Cargando mensaje personalizado...</p>
          )}
          {templateAction && message && (
            <CopyMessagePanel
              message={message}
              actionLabel={task.plantilla}
              onSent={() => executeLayer2()}
              onClose={() => setMessage(null)}
              pending={pending}
            />
          )}

          {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

          {/* Result buttons */}
          {resultScreen === "buttons" && (
            <div className="space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Resultado
              </p>
              <div className="grid grid-cols-3 gap-1.5">
                <ResultBtn label="Contactado" cls="text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-500/10 border-blue-200 dark:border-blue-500/30" onClick={() => setResultScreen("contactado")} disabled={pending} />
                <ResultBtn label="No contesto" cls="text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-500/10 border-slate-200 dark:border-slate-500/30" onClick={() => completeTask("no_contesto")} disabled={pending} />
                <ResultBtn label="Buzon" cls="text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-500/10 border-slate-200 dark:border-slate-500/30" onClick={() => completeTask("buzon")} disabled={pending} />
                <ResultBtn label="Reagendo" cls="text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-500/10 border-purple-200 dark:border-purple-500/30" onClick={() => completeTask("reagendado")} disabled={pending} />
                <ResultBtn label="VENTA" cls="text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/30" onClick={() => setShowSaleModal(true)} disabled={pending} />
                <ResultBtn label="No interesado" cls="text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/30" onClick={() => setResultScreen("no_interesado")} disabled={pending} />
              </div>
            </div>
          )}

          {/* Contactado sub-screen */}
          {resultScreen === "contactado" && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Objecion (opcional)</p>
                <button onClick={() => setResultScreen("buttons")} className="text-[10px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">&larr; Atras</button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {OBJECTION_CHIPS.map((c) => (
                  <button
                    key={c.value}
                    onClick={() => setObjectionChip(objectionChip === c.value ? null : c.value)}
                    className={`text-[11px] rounded-full border px-2.5 py-1 font-medium transition-colors ${
                      objectionChip === c.value
                        ? "bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-200 border-amber-300 dark:border-amber-500/40"
                        : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700"
                    }`}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
              <textarea
                value={nota}
                onChange={(e) => setNota(e.target.value)}
                placeholder="Nota (opcional)..."
                rows={2}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 resize-none focus:outline-none focus:ring-2 focus:ring-brand-500/30"
              />
              <button
                onClick={() => completeTask("contactado", { objectionChip: objectionChip ?? undefined })}
                disabled={pending}
                className="w-full rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-xs font-medium py-2 transition-colors disabled:opacity-50"
              >
                {pending ? "Guardando..." : "Guardar"}
              </button>
            </div>
          )}

          {/* No interesado sub-screen */}
          {resultScreen === "no_interesado" && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Motivo</p>
                <button onClick={() => setResultScreen("buttons")} className="text-[10px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">&larr; Atras</button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {MOTIVOS.map((m) => (
                  <button
                    key={m.value}
                    onClick={() => setMotivo(motivo === m.value ? null : m.value)}
                    className={`text-[11px] rounded-full border px-2.5 py-1 font-medium transition-colors ${
                      motivo === m.value
                        ? "bg-red-100 dark:bg-red-500/20 text-red-800 dark:text-red-200 border-red-300 dark:border-red-500/40"
                        : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700"
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              <textarea
                value={nota}
                onChange={(e) => setNota(e.target.value)}
                placeholder="Nota (opcional)..."
                rows={2}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 resize-none focus:outline-none focus:ring-2 focus:ring-brand-500/30"
              />
              <button
                onClick={() => completeTask("no_interesado", { motivoNoInteresado: motivo ?? undefined })}
                disabled={pending || !motivo}
                className="w-full rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-medium py-2 transition-colors disabled:opacity-50"
              >
                {pending ? "Guardando..." : "Confirmar perdido"}
              </button>
            </div>
          )}

          {/* Footer link to full detail */}
          <div className="pt-1 text-center">
            <a
              href={`/closer/leads/${task.lead_id}`}
              className="text-[11px] font-medium text-brand-600 dark:text-brand-400 hover:underline"
            >
              Ver historial completo &rarr;
            </a>
          </div>
        </div>
      )}

      {showSaleModal && (
        <MarkSaleModal
          leadId={task.lead_id}
          onClose={() => setShowSaleModal(false)}
        />
      )}
    </div>
  );
}

function ResultBtn({ label, cls, onClick, disabled }: { label: string; cls: string; onClick: () => void; disabled: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-xl border px-2 py-2 text-[11px] font-medium transition-colors disabled:opacity-50 hover:opacity-80 ${cls}`}
    >
      {label}
    </button>
  );
}
