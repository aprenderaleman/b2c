"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { TareaCloser } from "@/lib/closer-cadence";
import { MarkSaleModal } from "./MarkSaleModal";
import { RegistrarModal } from "./RegistrarModal";
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

type VentaPendiente = {
  id: string;
  pack_id: string;
  payment_type: string;
  estado: string;
} | null;

type LeadNote = {
  id: string;
  author: string;
  content: string;
  created_at: string;
};

type ActiveTrial = {
  id: string;
  scheduled_at: string;
  short_code: string | null;
} | null;

type Props = {
  lead: Lead;
  tasks: TareaCloser[];
  ventaPendiente: VentaPendiente;
  notes?: LeadNote[];
  leadTipo?: string | null;
  activeTrial?: ActiveTrial;
  teacherName?: string | null;
};

const GOAL_LABEL: Record<string, string> = {
  work:            "Trabajar en DACH",
  visa:            "Visa o residencia",
  studies:         "Estudiar en universidad",
  exam:            "Examen oficial",
  travel:          "Viajes y cultura",
  already_in_dach: "Ya vive en DACH",
};

const URGENCY_LABEL: Record<string, string> = {
  asap:           "Lo antes posible",
  under_3_months: "Menos de 3 meses",
  in_6_months:    "En 6 meses",
  next_year:      "El año que viene",
  just_looking:   "Solo mirando",
};

export function CloserLeadDetail({
  lead,
  tasks,
  ventaPendiente,
  notes,
  leadTipo,
  activeTrial,
  teacherName,
}: Props) {
  const router = useRouter();
  const [showSaleModal, setShowSaleModal] = useState(false);
  const [registrarTaskId, setRegistrarTaskId] = useState<string | null | "sin_tarea">(null);

  const pendingTasks = tasks.filter((t) => !t.fecha_completada);
  const nextTask = pendingTasks.length > 0
    ? pendingTasks.reduce((earliest, t) =>
        new Date(t.fecha_programada) < new Date(earliest.fecha_programada) ? t : earliest
      )
    : null;

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
            {lead.estado_cierre !== "convertido" && lead.estado_cierre !== "perdido" && (
              <button
                onClick={() => setRegistrarTaskId(nextTask?.id ?? "sin_tarea")}
                className="text-xs font-semibold rounded-full bg-brand-600 hover:bg-brand-700 text-white px-3.5 py-1.5 transition-colors"
              >
                Registrar
              </button>
            )}
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
          </div>
        </div>
      </header>

      {/* 2-column layout */}
      <div className="grid gap-5 lg:grid-cols-3">
        {/* LEFT column (1/3): funnel data + diagnosis + notes */}
        <div className="space-y-5 lg:col-span-1">
          <Panel title="Datos del funnel">
            <Kv k="Creado" v={fmtRelative(lead.created_at)} />
            <Kv k="Landing" v={sourceMeta.label} />
            {lead.german_level && <Kv k="Nivel de alemán" v={lead.german_level} />}
            {lead.goal && <Kv k="Objetivo" v={GOAL_LABEL[lead.goal] ?? lead.goal} />}
            {lead.urgency && <Kv k="Urgencia" v={URGENCY_LABEL[lead.urgency] ?? lead.urgency} />}
            {lead.budget && <Kv k="Presupuesto" v={lead.budget} />}
            {lead.email && <Kv k="Email" v={lead.email} />}
            {(lead.messages_seen_count ?? 0) > 0 && (
              <Kv k="Mensajes vistos" v={String(lead.messages_seen_count)} />
            )}
            {(lead.current_followup_number ?? 0) > 0 && (
              <Kv k="Seguimiento #" v={String(lead.current_followup_number)} />
            )}
            {lead.next_contact_date && (
              <Kv k="Próximo contacto" v={new Date(lead.next_contact_date).toLocaleString("es-ES")} />
            )}
            {(activeTrial || lead.trial_scheduled_at) && (
              <Kv
                k="Clase de prueba"
                v={activeTrial ? fmtTrialDate(activeTrial.scheduled_at) : fmtTrialDate(lead.trial_scheduled_at as string)}
              />
            )}
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

          {/* Unified notes: teacher + Gelfis + closer */}
          <Panel title={`Notas${notes && notes.length > 0 ? ` (${notes.length})` : ""}`}>
            {notes && notes.length > 0 ? (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {notes.map((n) => (
                  <li key={n.id} className="py-2">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="font-semibold text-slate-600 dark:text-slate-300">{n.author}</span>
                      <span className="ml-auto text-slate-400 dark:text-slate-500">
                        {new Date(n.created_at).toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" })}
                      </span>
                    </div>
                    <div className="mt-0.5 text-sm text-slate-800 dark:text-slate-200 whitespace-pre-wrap">{n.content}</div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-400 dark:text-slate-500 italic">Aún no hay notas.</p>
            )}
          </Panel>

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
                onClick={() => setRegistrarTaskId(nextTask.id)}
                className="flex-shrink-0 text-xs font-medium rounded-full border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 px-3 py-1.5 hover:bg-emerald-100 dark:hover:bg-emerald-500/20 transition-colors"
              >
                Registrar
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
                      onClick={() => setRegistrarTaskId(t.id)}
                      className="text-xs font-medium text-brand-600 dark:text-brand-400 hover:underline flex-shrink-0"
                    >
                      Registrar
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

        </div>
      </div>

      {/* Modals */}
      {showSaleModal && (
        <MarkSaleModal
          leadId={lead.id}
          onClose={() => setShowSaleModal(false)}
        />
      )}

      {registrarTaskId && (
        <RegistrarModal
          leadId={lead.id}
          leadName={lead.name ?? "Lead"}
          taskId={registrarTaskId === "sin_tarea" ? null : registrarTaskId}
          onClose={() => setRegistrarTaskId(null)}
          onVenta={() => { setRegistrarTaskId(null); setShowSaleModal(true); }}
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

