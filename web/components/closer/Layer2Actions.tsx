"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CopyMessagePanel } from "./CopyMessagePanel";
import { RITMOS, ACTION_BUTTONS, type ActionButton } from "@/lib/closer-constants";
import { PaymentLinkModal } from "@/app/profesor/clasedeprueba/PaymentLinkModal";
import { ConfirmPaymentModal } from "@/components/teacher/ConfirmPaymentModal";

type Props = {
  leadId: string;
  leadName: string;
  /** Datos para ConfirmPaymentModal (mismo form que el Trial Hub del profe) */
  leadEmail?: string | null;
  leadPhone?: string | null;
  leadLanguage?: "es" | "de";
  leadGermanLevel?: string | null;
  leadGoal?: string | null;
};

type ActiveAction =
  | null
  | { type: "ritmo_picker" }
  | { type: "fecha_picker" }
  | { type: "copy_panel"; action: string; label: string; message: string; extras?: Record<string, string> };


export function Layer2Actions({
  leadId,
  leadName,
  leadEmail,
  leadPhone,
  leadLanguage,
  leadGermanLevel,
  leadGoal,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [activeAction, setActiveAction] = useState<ActiveAction>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedRitmo, setSelectedRitmo] = useState<string | null>(null);
  const [fecha, setFecha] = useState("");
  const [nota, setNota] = useState("");
  const [loading, setLoading] = useState(false);
  const [enlaceOpen, setEnlaceOpen] = useState(false);
  const [confirmPagoOpen, setConfirmPagoOpen] = useState(false);
  const [rescheduling, setRescheduling] = useState(false);

  // Mismo comportamiento que el botón 📅 Reagendar del Trial Hub del profe
  const handleReagendar = async () => {
    if (!confirm(
      "REAGENDAR clase de prueba.\n\n" +
      "Esto va a:\n" +
      "  • Cancelar la clase futura del lead (si existe).\n" +
      "  • Enviar por WhatsApp el link a /agendar/cuando.\n" +
      "  • Cambiar el estado del lead a 'Reagendando'.\n\n" +
      "Cuando el lead elija nuevo horario, vuelve a 'Clase agendada' automáticamente.\n\n" +
      "¿Continuar?"
    )) return;
    setRescheduling(true);
    setError(null);
    try {
      const res = await fetch(`/api/teacher/trial/${leadId}/send-reschedule-link`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.reason ?? `HTTP ${res.status}`);
      alert("💬 Mensaje de reagendar enviado.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al enviar reagendamiento");
    } finally {
      setRescheduling(false);
    }
  };

  const executeAction = (action: string, extras?: Record<string, string>) => {
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/closer/leads/${leadId}/layer2`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extras }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.error ?? "Error al ejecutar accion");
        return;
      }
      setActiveAction(null);
      setSelectedRitmo(null);
      setFecha("");
      setNota("");
      router.refresh();
    });
  };

  const previewMessage = async (action: string, label: string, extras?: Record<string, string>) => {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/closer/leads/${leadId}/layer2`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, preview: true, ...extras }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.error ?? "Error al cargar mensaje");
        return;
      }
      const data = await res.json();
      const message = data.message || `Hola ${leadName}, [mensaje de ${label}]`;
      setActiveAction({ type: "copy_panel", action, label, message, extras });
    } finally {
      setLoading(false);
    }
  };

  const handleClick = (btn: ActionButton) => {
    if (btn.isEnlace) {
      setEnlaceOpen(true);
      return;
    }
    if (btn.isConfirmarPago) {
      setConfirmPagoOpen(true);
      return;
    }
    if (btn.isReagendar) {
      void handleReagendar();
      return;
    }
    if (btn.isWebLink) {
      window.open(`https://www.aprender-aleman.de/inscripciones?ref=${leadId}`, "_blank", "noopener,noreferrer");
      return;
    }
    if (btn.needsRitmo) {
      setActiveAction({ type: "ritmo_picker" });
      return;
    }
    if (btn.needsFecha) {
      setActiveAction({ type: "fecha_picker" });
      return;
    }
    if (btn.isCopy) {
      previewMessage(btn.action, btn.label);
      return;
    }
    executeAction(btn.action);
  };

  const handleRitmoSubmit = () => {
    if (!selectedRitmo) return;
    previewMessage("enviar_propuesta", "Propuesta", { ritmoId: selectedRitmo });
  };

  const handleFechaSubmit = () => {
    if (!fecha) return;
    executeAction("seguimiento_fecha", { fecha, nota: nota || undefined } as Record<string, string>);
  };

  if (activeAction?.type === "copy_panel") {
    return (
      <CopyMessagePanel
        message={activeAction.message}
        actionLabel={activeAction.label}
        onSent={() => {
          executeAction(activeAction.action, activeAction.extras);
        }}
        onClose={() => setActiveAction(null)}
        pending={pending}
      />
    );
  }

  return (
    <section className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 space-y-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
        Acciones
      </h2>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {activeAction === null && (
        <div className="grid grid-cols-2 gap-2">
          {ACTION_BUTTONS.map((btn) => (
            <button
              key={btn.action}
              onClick={() => handleClick(btn)}
              disabled={pending || loading || rescheduling}
              className="flex items-center gap-2 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3 text-left hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-50"
            >
              <span className="text-lg flex-shrink-0">{btn.icon}</span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate">
                  {btn.label}
                </p>
                <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                  {btn.description}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}

      {loading && (
        <p className="text-sm text-slate-500 dark:text-slate-400 text-center py-4 animate-pulse">
          Cargando mensaje personalizado...
        </p>
      )}

      {activeAction?.type === "ritmo_picker" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Seleccionar ritmo
            </p>
            <button
              onClick={() => { setActiveAction(null); setSelectedRitmo(null); }}
              className="text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
            >
              Cancelar
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {RITMOS.map((r) => (
              <button
                key={r.id}
                onClick={() => setSelectedRitmo(r.id)}
                className={`rounded-2xl border p-3 text-left transition-colors ${
                  selectedRitmo === r.id
                    ? "bg-brand-50 dark:bg-brand-500/10 border-brand-300 dark:border-brand-500/40"
                    : "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700"
                }`}
              >
                <span className="text-lg">{r.emoji}</span>
                <p className="text-sm font-medium text-slate-800 dark:text-slate-200">{r.name}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">{r.pricePerMonth} EUR/mes</p>
              </button>
            ))}
          </div>
          <button
            onClick={handleRitmoSubmit}
            disabled={!selectedRitmo || pending || loading}
            className="w-full btn-primary disabled:opacity-50"
          >
            {loading ? "Cargando..." : pending ? "Enviando..." : "Ver mensaje"}
          </button>
        </div>
      )}

      {activeAction?.type === "fecha_picker" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Programar seguimiento
            </p>
            <button
              onClick={() => { setActiveAction(null); setFecha(""); setNota(""); }}
              className="text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
            >
              Cancelar
            </button>
          </div>
          <input
            type="datetime-local"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            className="input-text text-sm"
          />
          <textarea
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            placeholder="Nota (opcional)"
            rows={2}
            className="input-text text-sm"
          />
          <button
            onClick={handleFechaSubmit}
            disabled={!fecha || pending}
            className="w-full btn-primary disabled:opacity-50"
          >
            {pending ? "Guardando..." : "Programar"}
          </button>
        </div>
      )}

      {/* Modales compartidos con el Trial Hub del profesor */}
      {enlaceOpen && (
        <PaymentLinkModal
          leadId={leadId}
          leadName={leadName}
          onClose={() => { setEnlaceOpen(false); router.refresh(); }}
        />
      )}

      {confirmPagoOpen && (
        <ConfirmPaymentModal
          leadId={leadId}
          leadName={leadName}
          leadEmail={leadEmail ?? null}
          leadPhone={leadPhone ?? null}
          leadLanguage={leadLanguage ?? "es"}
          leadGermanLevel={leadGermanLevel ?? null}
          leadGoal={leadGoal ?? null}
          onClose={() => { setConfirmPagoOpen(false); router.refresh(); }}
        />
      )}
    </section>
  );
}
