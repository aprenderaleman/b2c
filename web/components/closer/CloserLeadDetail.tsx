"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { TareaCloser } from "@/lib/closer-cadence";
import { MarkSaleModal } from "./MarkSaleModal";
import { QuickActionModal } from "./QuickActionModal";
import { Layer2Actions } from "./Layer2Actions";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { PriorityBadges, summarizeQualification } from "@/components/admin/PriorityBadge";
import { SOURCE_META, fmtRelative, fmtTrialDate } from "@/lib/closer-constants";

type Lead = {
  id: string;
  name: string | null;
  email: string | null;
  whatsapp_normalized: string | null;
  status: string;
  estado_cierre: string;
  motivo_perdido: string | null;
  fecha_asignacion_closer: string | null;
  created_at: string;
  reserva_prioritaria?: boolean | null;
  priority_deadline?: string | null;
  deposit_intent_at?: string | null;
  qualification_answers?: { goal?: string; level?: string; deadline?: string } | null;
  landing_intent?: string | null;
  source?: string | null;
  language?: string | null;
  german_level?: string | null;
  goal?: string | null;
  urgency?: string | null;
  budget?: string | null;
  messages_seen_count?: number | null;
  current_followup_number?: number | null;
  next_contact_date?: string | null;
  gdpr_accepted?: boolean | null;
  gdpr_accepted_at?: string | null;
  trial_scheduled_at?: string | null;
  trial_attended_at?: string | null;
  trial_absent_at?: string | null;
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
  id: string;
  content: string;
  created_at: string;
};

type ActiveTrial = {
  id: string;
  scheduled_at: string;
  short_code: string | null;
} | null;

type GelfisNote = {
  id: string;
  lead_id: string;
  created_at: string;
  note: string;
};

type Props = {
  lead: Lead;
  tasks: TareaCloser[];
  timeline: TimelineEntry[];
  acciones: Accion[];
  ventaPendiente: VentaPendiente;
  teacherNotes?: TeacherNote[];
  leadTipo?: string | null;
  activeTrial?: ActiveTrial;
  teacherName?: string | null;
  gelfisNotes?: GelfisNote[];
};

const TIMELINE_LABELS: Record<string, string> = {
  system_message_sent:    "Mensaje enviado",
  lead_message_received:  "Mensaje del lead",
  status_change:          "Cambio de estado",
  agent_note:             "Nota del agente",
  gelfis_note:            "Nota de Gelfis",
  calendly_event:         "Evento Calendly",
  trial_reminder:         "Recordatorio de clase",
  conversion:             "Conversión",
  escalation:             "Escalado",
  send_failed:            "Envío fallido",
  whatsapp_read_receipt:  "WhatsApp leído",
};

const TIMELINE_COLOR: Record<string, string> = {
  system_message_sent:    "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30",
  lead_message_received:  "bg-blue-50    dark:bg-blue-500/10    text-blue-700    dark:text-blue-300    border-blue-200    dark:border-blue-500/30",
  status_change:          "bg-slate-50   dark:bg-slate-800      text-slate-700   dark:text-slate-300   border-slate-200   dark:border-slate-700",
  agent_note:             "bg-slate-50   dark:bg-slate-800      text-slate-500   dark:text-slate-400   border-slate-200   dark:border-slate-700",
  gelfis_note:            "bg-orange-50  dark:bg-orange-500/10  text-orange-700  dark:text-orange-300  border-orange-200  dark:border-orange-500/30",
  calendly_event:         "bg-violet-50  dark:bg-violet-500/10  text-violet-700  dark:text-violet-300  border-violet-200  dark:border-violet-500/30",
  trial_reminder:         "bg-cyan-50    dark:bg-cyan-500/10    text-cyan-700    dark:text-cyan-300    border-cyan-200    dark:border-cyan-500/30",
  conversion:             "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30",
  escalation:             "bg-red-50     dark:bg-red-500/10     text-red-700     dark:text-red-300     border-red-200     dark:border-red-500/30",
  send_failed:            "bg-red-50     dark:bg-red-500/10     text-red-700     dark:text-red-300     border-red-200     dark:border-red-500/30",
  whatsapp_read_receipt:  "bg-slate-50   dark:bg-slate-800      text-slate-500   dark:text-slate-400   border-slate-200   dark:border-slate-700",
};

export function CloserLeadDetail({
  lead,
  tasks,
  timeline,
  acciones,
  ventaPendiente,
  teacherNotes,
  leadTipo,
  activeTrial,
  teacherName,
  gelfisNotes,
}: Props) {
  const router = useRouter();
  const [showSaleModal, setShowSaleModal] = useState(false);
  const [showLostForm, setShowLostForm] = useState(false);
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
  const sourceMeta = SOURCE_META[lead.landing_intent ?? "(sin landing)"] ?? SOURCE_META["(sin landing)"];
  const attState = lead.trial_attended_at ? "attended"
    : lead.trial_absent_at ? "absent"
    : lead.trial_scheduled_at ? "scheduled" : null;

  return (
    <>
      {/* Back link */}
      <button
        onClick={() => router.push("/closer/leads")}
        className="text-sm text-slate-500 dark:text-slate-400 hover:text-brand-600 dark:hover:text-brand-400"
      >
        &larr; Mis leads
      </button>

      {/* Header */}
      <header className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50 flex items-center gap-2 flex-wrap">
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
            </h1>

            <div className="mt-1 flex items-center gap-3 text-sm text-slate-600 dark:text-slate-300 flex-wrap">
              {phoneDigits ? (
                <a
                  href={`https://wa.me/${phoneDigits}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-brand-600 dark:text-brand-400 hover:underline"
                >
                  {lead.whatsapp_normalized}
                </a>
              ) : lead.email ? (
                <a
                  href={`mailto:${lead.email}`}
                  className="font-mono text-brand-600 dark:text-brand-400 hover:underline"
                >
                  {lead.email}
                </a>
              ) : (
                <span className="text-slate-400 dark:text-slate-500 italic">sin contacto</span>
              )}
              <span className="text-slate-300 dark:text-slate-600">·</span>
              <span>{(lead.language ?? "es").toUpperCase()}</span>
              <span className="text-slate-300 dark:text-slate-600">·</span>
              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold border ${sourceMeta.sourceCls}`}>
                {sourceMeta.sourceIcon} {sourceMeta.sourceLabel}
              </span>
              <span className="text-slate-300 dark:text-slate-600">·</span>
              <StatusBadge status={lead.status} />
              <PriorityBadges flags={{
                reservaPrioritaria: lead.reserva_prioritaria,
                priorityDeadline: lead.priority_deadline,
                depositIntentAt: lead.deposit_intent_at,
              }} />
            </div>

            {(() => {
              const q = summarizeQualification(lead.qualification_answers);
              if (!q) return null;
              return (
                <div className="mt-2 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 px-3 py-2 text-[12.5px] text-slate-700 dark:text-slate-300">
                  {q}
                </div>
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
          </div>
        </div>
      </header>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {/* 2-column layout */}
      <div className="grid gap-5 lg:grid-cols-3">
        {/* LEFT column (1/3): funnel data + diagnosis + notes */}
        <div className="space-y-5 lg:col-span-1">
          <Panel title="Datos del funnel">
            <Kv k="Creado" v={fmtRelative(lead.created_at)} />
            <Kv k="Origen" v={lead.source ?? "—"} />
            <Kv k="Landing" v={sourceMeta.label} />
            <Kv k="Nivel de alemán" v={lead.german_level ?? "—"} />
            <Kv k="Objetivo" v={lead.goal ?? "—"} />
            <Kv k="Urgencia" v={lead.urgency ?? "—"} />
            <Kv k="Presupuesto" v={lead.budget ?? "—"} />
            <Kv k="Email" v={lead.email ?? "—"} />
            <Kv k="Mensajes vistos" v={String(lead.messages_seen_count ?? 0)} />
            <Kv k="Seguimiento #" v={String(lead.current_followup_number ?? 0)} />
            <Kv k="Próximo contacto" v={lead.next_contact_date ? new Date(lead.next_contact_date).toLocaleString("es-ES") : "—"} />
            <Kv
              k="Clase agendada"
              v={activeTrial ? fmtTrialDate(activeTrial.scheduled_at) : lead.trial_scheduled_at ? fmtTrialDate(lead.trial_scheduled_at) : "—"}
            />
            {teacherName && <Kv k="Profe del trial" v={teacherName} />}
            {attState && (
              <Kv
                k="Asistencia"
                v={attState === "attended" ? "✓ Asistió" : attState === "absent" ? "✗ No asistió" : "Pendiente"}
              />
            )}
            {activeTrial?.short_code && (
              <Kv k="Enlace clase" v={`/c/${activeTrial.short_code}`} />
            )}
            <Kv k="RGPD" v={lead.gdpr_accepted ? `Sí${lead.gdpr_accepted_at ? ` · ${new Date(lead.gdpr_accepted_at).toLocaleDateString("es-ES")}` : ""}` : "No"} />
          </Panel>

          {/* Diagnosis */}
          {(lead.qualification_answers || (teacherNotes && teacherNotes.length > 0)) && (
            <Panel title="Diagnóstico">
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
              {teacherNotes && teacherNotes.length > 0 && (
                <div className={lead.qualification_answers ? "border-t border-slate-100 dark:border-slate-800 pt-3 mt-3" : ""}>
                  <p className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                    Notas del profe ({teacherNotes.length})
                  </p>
                  <ul className="space-y-2">
                    {teacherNotes.map((tn) => (
                      <li key={tn.id}>
                        <p className="text-sm text-slate-700 dark:text-slate-300 italic">
                          &ldquo;{tn.content}&rdquo;
                        </p>
                        <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">
                          {new Date(tn.created_at).toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" })}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Panel>
          )}

          {/* Gelfis notes (read-only for closers) */}
          {gelfisNotes && gelfisNotes.length > 0 && (
            <Panel title="Notas de Gelfis">
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {gelfisNotes.map((n) => (
                  <li key={n.id} className="py-2">
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      {new Date(n.created_at).toLocaleString("es-ES")}
                    </div>
                    <div className="text-sm text-slate-800 dark:text-slate-200 whitespace-pre-wrap">{n.note}</div>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {/* Closer notes */}
          <InlineNoteInput leadId={lead.id} />
        </div>

        {/* RIGHT column (2/3): actions + tasks + timeline */}
        <div className="space-y-5 lg:col-span-2">
          {/* Next pending action */}
          {nextTask && (
            <section className="rounded-3xl bg-brand-50/60 dark:bg-brand-500/5 border border-brand-200 dark:border-brand-500/20 p-4 flex items-center gap-3">
              <span className="flex-shrink-0 w-8 h-8 rounded-full bg-brand-100 dark:bg-brand-500/20 flex items-center justify-center text-xs font-bold text-brand-700 dark:text-brand-300">
                {nextTask.canal === "llamada" ? "Tel" : nextTask.canal === "whatsapp" ? "WA" : "Em"}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-brand-800 dark:text-brand-200">
                  Próxima acción: {nextTask.plantilla}
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
            <Panel title={`Tareas pendientes (${pendingTasks.length})`}>
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
            </Panel>
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
          <Panel title={`Historial (${allEvents.length})`}>
            {allEvents.length === 0 ? (
              <p className="text-sm text-slate-400">Sin actividad registrada.</p>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {allEvents.map((event) => {
                  const cls = TIMELINE_COLOR[event.type] ?? "bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700";
                  const label = event.source === "accion"
                    ? event.type
                    : (TIMELINE_LABELS[event.type] ?? event.type);
                  return (
                    <li key={`${event.source}-${event.id}`} className="py-3">
                      <div className="flex items-center gap-2 text-xs">
                        <span className={`rounded-full border px-2 py-0.5 font-medium ${cls}`}>{label}</span>
                        <span className="text-slate-500 dark:text-slate-400">{event.author}</span>
                        <span className="ml-auto text-slate-400 dark:text-slate-500">
                          {new Date(event.created_at).toLocaleString("es-ES")}
                        </span>
                      </div>
                      <div className="mt-1 text-sm text-slate-800 dark:text-slate-200 whitespace-pre-wrap">{event.content}</div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        </div>
      </div>

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

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Kv({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1 text-sm">
      <span className="text-slate-500 dark:text-slate-400">{k}</span>
      <span className="text-slate-900 dark:text-slate-100 text-right break-all">{v}</span>
    </div>
  );
}

function InlineNoteInput({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [saving, startSaving] = useTransition();

  const handleSubmit = () => {
    if (!note.trim()) return;
    startSaving(async () => {
      const res = await fetch(`/api/closer/leads/${leadId}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tipo: "nota", contenido: note.trim() }),
      });
      if (res.ok) {
        setNote("");
        router.refresh();
      }
    });
  };

  return (
    <Panel title="Agregar nota">
      <div className="flex gap-2">
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Escribe una nota sobre este lead..."
          rows={2}
          className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 resize-none focus:outline-none focus:ring-2 focus:ring-brand-500/30"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSubmit();
          }}
        />
        <button
          onClick={handleSubmit}
          disabled={!note.trim() || saving}
          className="self-end rounded-xl bg-brand-600 hover:bg-brand-700 disabled:opacity-50 px-4 py-2 text-sm font-medium text-white transition-colors"
        >
          {saving ? "..." : "Guardar"}
        </button>
      </div>
      <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1">
        Ctrl+Enter para guardar
      </p>
    </Panel>
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
