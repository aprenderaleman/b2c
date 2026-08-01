"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { TareaCloser } from "@/lib/closer-cadence";
import { MarkSaleModal } from "./MarkSaleModal";
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
  // Meta Ads Paid funnel (2026-07-28)
  reserva_prioritaria?: boolean | null;
  priority_deadline?:   string | null;
  deposit_intent_at?:   string | null;
  qualification_answers?: { goal?: string; level?: string; deadline?: string } | null;
  landing_intent?:      string | null;
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

type Props = {
  lead: Lead;
  tasks: TareaCloser[];
  timeline: TimelineEntry[];
  acciones: Accion[];
  ventaPendiente: VentaPendiente;
};

export function CloserLeadDetail({ lead, tasks, timeline, acciones, ventaPendiente }: Props) {
  const router = useRouter();
  const [showSaleModal, setShowSaleModal] = useState(false);
  const [showLostForm, setShowLostForm] = useState(false);
  const [showActionForm, setShowActionForm] = useState(false);
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
  const completedTasks = tasks.filter((t) => t.fecha_completada);

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
            <PriorityBadges flags={{
              reservaPrioritaria: lead.reserva_prioritaria,
              priorityDeadline:   lead.priority_deadline,
              depositIntentAt:    lead.deposit_intent_at,
            }} />
          </h1>
          {(() => {
            const q = summarizeQualification(lead.qualification_answers);
            if (!q) return null;
            return (
              <p className="mt-1 text-[12.5px] text-slate-600 dark:text-slate-400">
                📋 {q}
              </p>
            );
          })()}
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {lead.whatsapp_normalized && (
              <a
                href={`https://wa.me/${lead.whatsapp_normalized.replace(/\D/g, "")}`}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-emerald-600"
              >
                {lead.whatsapp_normalized}
              </a>
            )}
            {lead.whatsapp_normalized && lead.email && " · "}
            {lead.email}
          </p>
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

      {/* Pending tasks */}
      {pendingTasks.length > 0 && (
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
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Timeline */}
      <section className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300 mb-3">
          Actividad
        </h2>
        <div className="space-y-3 divide-y divide-slate-100 dark:divide-slate-800">
          {allEvents.map((event) => (
            <div key={`${event.source}-${event.id}`} className="pt-3 first:pt-0">
              <div className="flex items-start gap-2">
                <span className={`flex-shrink-0 w-2 h-2 mt-1.5 rounded-full ${
                  event.source === "accion"
                    ? "bg-brand-500"
                    : event.type === "conversion"
                      ? "bg-emerald-500"
                      : "bg-slate-300 dark:bg-slate-600"
                }`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-slate-700 dark:text-slate-300">{event.content}</p>
                  <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                    {event.author} · {new Date(event.created_at).toLocaleDateString("es", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
              </div>
            </div>
          ))}
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
