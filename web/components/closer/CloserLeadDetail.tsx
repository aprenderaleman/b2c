"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { TareaCloser } from "@/lib/closer-cadence";
import { MarkSaleModal } from "./MarkSaleModal";
import { QuickActionModal } from "./QuickActionModal";
import { Layer2Actions } from "./Layer2Actions";
import { PriorityBadges, summarizeQualification } from "@/components/admin/PriorityBadge";

type Lead = {
  id: string;
  name: string | null;
  email: string | null;
  whatsapp_normalized: string | null;
  status: string;
  estado_cierre: string;
  motivo_perdido: string | null;
  fecha_asignacion_closer: string | null;
  reserva_prioritaria?: boolean | null;
  priority_deadline?: string | null;
  deposit_intent_at?: string | null;
  qualification_answers?: { goal?: string; level?: string; deadline?: string } | null;
  landing_intent?: string | null;
};

type TimelineEntry = {
  id: string;
  type: string;
  author: string;
  content: string;
  created_at: string;
};

type Accion = {
  id: string;
  tipo: string;
  contenido: string | null;
  resultado: string | null;
  created_at: string;
};

type VentaPendiente = {
  id: string;
  pack_id: string;
  payment_type: string;
  estado: string;
} | null;

type TeacherNote = {
  content: string;
  created_at: string;
} | null;

type Props = {
  lead: Lead;
  tasks: TareaCloser[];
  timeline: TimelineEntry[];
  acciones: Accion[];
  ventaPendiente: VentaPendiente;
  teacherNote?: TeacherNote;
  leadTipo?: string | null;
};

const AUTHOR_BADGE: Record<string, { label: string; cls: string }> = {
  system: {
    label: "Sistema",
    cls: "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300",
  },
  teacher: {
    label: "Profe",
    cls: "bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300",
  },
  closer: {
    label: "Closer",
    cls: "bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-300",
  },
  admin: {
    label: "Admin",
    cls: "bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300",
  },
  student: {
    label: "Alumno",
    cls: "bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300",
  },
  stiv: {
    label: "Stiv",
    cls: "bg-cyan-100 dark:bg-cyan-500/20 text-cyan-700 dark:text-cyan-300",
  },
};

const EVENT_DOT: Record<string, string> = {
  closer: "bg-purple-500",
  teacher: "bg-blue-500",
  admin: "bg-amber-500",
  system: "bg-slate-400 dark:bg-slate-500",
  stiv: "bg-cyan-500",
};

export function CloserLeadDetail({
  lead,
  tasks,
  timeline,
  acciones,
  ventaPendiente,
  teacherNote,
  leadTipo,
}: Props) {
  const router = useRouter();
  const [showSaleModal, setShowSaleModal] = useState(false);
  const [showLostForm, setShowLostForm] = useState(false);
  const [showActionForm, setShowActionForm] = useState(false);
  const [completeTaskId, setCompleteTaskId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const allEvents = [
    ...timeline.map((t) => ({ ...t, source: "timeline" as const, sortDate: t.created_at })),
    ...acciones.map((a) => ({
      id: a.id,
      type: a.tipo,
      author: "closer",
      content: a.contenido ?? a.resultado ?? "",
      created_at: a.created_at,
      source: "accion" as const,
      sortDate: a.created_at,
    })),
  ].sort((a, b) => new Date(b.sortDate).getTime() - new Date(a.sortDate).getTime());

  const pendingTasks = tasks.filter((t) => !t.fecha_completada);
  const nextTask = pendingTasks.length > 0
    ? pendingTasks.reduce((earliest, t) =>
        new Date(t.fecha_programada) < new Date(earliest.fecha_programada) ? t : earliest
      )
    : null;

  const handleMarkLost = (motivo: string) => {
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/closer/leads/${lead.id}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tipo: "nota", contenido: `Marcado perdido: ${motivo}` }),
      });
      if (!res.ok) {
        setError("Error al marcar como perdido");
        return;
      }
      setShowLostForm(false);
      router.refresh();
    });
  };

  const phoneDigits = lead.whatsapp_normalized?.replace(/\D/g, "") ?? "";

  return (
    <>
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <button
            onClick={() => router.push("/closer/leads")}
            className="text-sm text-slate-500 dark:text-slate-400 hover:text-brand-600 dark:hover:text-brand-400"
          >
            &larr; Mis leads
          </button>
          <h1 className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-50 flex items-center gap-2 flex-wrap">
            {lead.name ?? "Lead"}
            {leadTipo && (
              <span
                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${
                  leadTipo === "tipo_a"
                    ? "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30"
                    : "bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-500/30"
                }`}
              >
                Tipo {leadTipo === "tipo_a" ? "A" : "B"}
              </span>
            )}
            <PriorityBadges flags={{
              reservaPrioritaria: lead.reserva_prioritaria,
              priorityDeadline: lead.priority_deadline,
              depositIntentAt: lead.deposit_intent_at,
            }} />
          </h1>

          {/* Contact links */}
          <div className="mt-1.5 flex items-center gap-3 flex-wrap">
            {phoneDigits && (
              <>
                <a
                  href={`https://wa.me/${phoneDigits}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-emerald-600 dark:text-emerald-400 hover:underline"
                >
                  <span className="text-base">WA</span>
                  <span>{lead.whatsapp_normalized}</span>
                </a>
                <a
                  href={`tel:+${phoneDigits}`}
                  className="inline-flex items-center gap-1 text-sm text-blue-600 dark:text-blue-400 hover:underline"
                >
                  <span className="text-base">Tel</span>
                  <span>{lead.whatsapp_normalized}</span>
                </a>
              </>
            )}
            {lead.email && (
              <span className="text-sm text-slate-500 dark:text-slate-400">
                {lead.email}
              </span>
            )}
          </div>

          {/* Qualification summary */}
          {(() => {
            const q = summarizeQualification(lead.qualification_answers);
            if (!q) return null;
            return (
              <p className="mt-1 text-[12.5px] text-slate-600 dark:text-slate-400">
                {q}
              </p>
            );
          })()}
        </div>

        <div className="flex gap-2 flex-wrap">
          {!ventaPendiente && lead.estado_cierre !== "convertido" && lead.estado_cierre !== "perdido" && (
            <button
              onClick={() => setShowSaleModal(true)}
              className="text-xs font-medium rounded-full border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 px-3 py-1"
            >
              Marcar venta
            </button>
          )}
          {ventaPendiente && (
            <span className="text-xs font-medium rounded-full border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 px-3 py-1">
              Venta pendiente
            </span>
          )}
          {lead.estado_cierre !== "perdido" && lead.estado_cierre !== "convertido" && (
            <button
              onClick={() => setShowLostForm(true)}
              className="text-xs font-medium rounded-full border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 px-3 py-1"
            >
              Marcar perdido
            </button>
          )}
          <button
            onClick={() => setShowActionForm(true)}
            className="text-xs font-medium rounded-full border border-slate-200 dark:border-slate-700 px-3 py-1 text-slate-700 dark:text-slate-300"
          >
            Registrar accion
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {/* Diagnosis block */}
      {(lead.qualification_answers || teacherNote) && (
        <section className="rounded-3xl bg-gradient-to-br from-blue-50/80 to-slate-50 dark:from-blue-500/5 dark:to-slate-900 border border-blue-200 dark:border-blue-500/20 p-5 space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-400">
            Diagnostico
          </h2>

          {lead.qualification_answers && (
            <div className="grid grid-cols-3 gap-3">
              {lead.qualification_answers.goal && (
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">Meta</p>
                  <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
                    {lead.qualification_answers.goal}
                  </p>
                </div>
              )}
              {lead.qualification_answers.level && (
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">Nivel</p>
                  <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
                    {lead.qualification_answers.level}
                  </p>
                </div>
              )}
              {lead.qualification_answers.deadline && (
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">Plazo</p>
                  <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
                    {lead.qualification_answers.deadline}
                  </p>
                </div>
              )}
            </div>
          )}

          {teacherNote && (
            <div className="border-t border-blue-100 dark:border-blue-500/10 pt-3">
              <p className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                Nota del profe
              </p>
              <p className="text-sm text-slate-700 dark:text-slate-300 italic">
                &ldquo;{teacherNote.content}&rdquo;
              </p>
              <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">
                {new Date(teacherNote.created_at).toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" })}
              </p>
            </div>
          )}
        </section>
      )}

      {/* Next pending action */}
      {nextTask && (
        <section className="rounded-3xl bg-brand-50/60 dark:bg-brand-500/5 border border-brand-200 dark:border-brand-500/20 p-4 flex items-center gap-3">
          <span className="flex-shrink-0 w-8 h-8 rounded-full bg-brand-100 dark:bg-brand-500/20 flex items-center justify-center text-xs font-bold text-brand-700 dark:text-brand-300">
            {nextTask.canal === "llamada" ? "Tel" : nextTask.canal === "whatsapp" ? "WA" : "Em"}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-brand-800 dark:text-brand-200">
              Proxima accion: {nextTask.plantilla}
            </p>
            <p className="text-xs text-brand-600 dark:text-brand-400">
              {new Date(nextTask.fecha_programada).toLocaleDateString("es", { weekday: "short", day: "numeric", month: "short" })}
              {" · "}
              {new Date(nextTask.fecha_programada).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })}
              {" · Paso "}
              {nextTask.paso}
            </p>
          </div>
          {new Date(nextTask.fecha_programada) < new Date() && (
            <span className="flex-shrink-0 text-[10px] font-bold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 rounded-full px-2 py-0.5 uppercase">
              Vencida
            </span>
          )}
          <button
            onClick={() => setCompleteTaskId(nextTask.id)}
            className="flex-shrink-0 text-xs font-medium rounded-full border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 px-3 py-1.5 hover:bg-emerald-100 dark:hover:bg-emerald-500/20 transition-colors"
          >
            Completar
          </button>
        </section>
      )}

      {/* All pending tasks */}
      {pendingTasks.length > 1 && (
        <section className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300 mb-3">
            Tareas pendientes ({pendingTasks.length})
          </h2>
          <div className="space-y-2">
            {pendingTasks.map((t) => (
              <div key={t.id} className="flex items-center gap-3 p-2 rounded-xl border border-slate-100 dark:border-slate-800 text-sm">
                <span className="text-xs font-bold text-brand-700 dark:text-brand-300 bg-brand-50 dark:bg-brand-500/10 rounded-full px-2 py-0.5">
                  {t.canal}
                </span>
                <span className="flex-1 text-slate-700 dark:text-slate-300 truncate">{t.plantilla}</span>
                <span className="text-xs text-slate-400">
                  {new Date(t.fecha_programada).toLocaleDateString("es", { day: "numeric", month: "short" })}
                </span>
                <button
                  onClick={() => setCompleteTaskId(t.id)}
                  className="text-xs font-medium text-brand-600 dark:text-brand-400 hover:underline flex-shrink-0"
                >
                  Completar
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Layer 2 Actions */}
      {lead.estado_cierre !== "convertido" && lead.estado_cierre !== "perdido" && (
        <Layer2Actions
          leadId={lead.id}
          leadName={lead.name ?? "Lead"}
          onOpenSendOffer={() => setShowSaleModal(true)}
        />
      )}

      {/* Timeline */}
      <section className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300 mb-3">
          Actividad
        </h2>
        <div className="space-y-3 divide-y divide-slate-100 dark:divide-slate-800">
          {allEvents.map((event) => {
            const badge = AUTHOR_BADGE[event.author] ?? AUTHOR_BADGE.system;
            const dot = EVENT_DOT[event.author] ?? EVENT_DOT.system;
            return (
              <div key={`${event.source}-${event.id}`} className="pt-3 first:pt-0">
                <div className="flex items-start gap-2">
                  <span className={`flex-shrink-0 w-2 h-2 mt-1.5 rounded-full ${dot}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-700 dark:text-slate-300">{event.content}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={`inline-flex items-center rounded px-1.5 py-0 text-[10px] font-medium ${badge.cls}`}>
                        {badge.label}
                      </span>
                      <span className="text-[10px] text-slate-400 dark:text-slate-500">
                        {new Date(event.created_at).toLocaleDateString("es", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
          {allEvents.length === 0 && (
            <p className="text-sm text-slate-400">Sin actividad registrada.</p>
          )}
        </div>
      </section>

      {/* Modals */}
      {showSaleModal && (
        <MarkSaleModal
          leadId={lead.id}
          onClose={() => setShowSaleModal(false)}
        />
      )}

      {showLostForm && (
        <LostModal
          onClose={() => setShowLostForm(false)}
          onConfirm={handleMarkLost}
          pending={pending}
        />
      )}

      {showActionForm && (
        <ActionModal
          leadId={lead.id}
          onClose={() => { setShowActionForm(false); router.refresh(); }}
        />
      )}

      {completeTaskId && (
        <QuickActionModal
          taskId={completeTaskId}
          leadName={lead.name ?? "Lead"}
          onClose={() => setCompleteTaskId(null)}
          onVenta={() => { setCompleteTaskId(null); setShowSaleModal(true); }}
        />
      )}
    </>
  );
}

function LostModal({
  onClose,
  onConfirm,
  pending,
}: {
  onClose: () => void;
  onConfirm: (motivo: string) => void;
  pending: boolean;
}) {
  const [motivo, setMotivo] = useState("");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-md rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl p-6 space-y-4">
        <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-50">Marcar como perdido</h3>
        <input
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          placeholder="Motivo..."
          className="input-text"
        />
        <div className="flex justify-end gap-3">
          <button onClick={onClose} className="btn-secondary">Cancelar</button>
          <button
            onClick={() => onConfirm(motivo)}
            disabled={!motivo.trim() || pending}
            className="btn-primary bg-red-600 hover:bg-red-700"
          >
            {pending ? "Guardando..." : "Confirmar"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ActionModal({ leadId, onClose }: { leadId: string; onClose: () => void }) {
  const [tipo, setTipo] = useState("nota");
  const [contenido, setContenido] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/closer/leads/${leadId}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tipo, contenido }),
      });
      if (!res.ok) {
        setError("Error al registrar accion");
        return;
      }
      onClose();
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-md rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl p-6 space-y-4">
        <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-50">Registrar accion</h3>
        <select value={tipo} onChange={(e) => setTipo(e.target.value)} className="input-text">
          <option value="llamada">Llamada</option>
          <option value="whatsapp">WhatsApp</option>
          <option value="email">Email</option>
          <option value="nota">Nota</option>
          <option value="otro">Otro</option>
        </select>
        <textarea
          value={contenido}
          onChange={(e) => setContenido(e.target.value)}
          placeholder="Detalle..."
          rows={3}
          className="input-text"
        />
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex justify-end gap-3">
          <button onClick={onClose} className="btn-secondary">Cancelar</button>
          <button onClick={submit} disabled={pending} className="btn-primary">
            {pending ? "Guardando..." : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}
