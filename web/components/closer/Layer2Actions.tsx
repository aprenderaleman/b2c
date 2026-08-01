"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CopyMessagePanel } from "./CopyMessagePanel";

type RitmoOption = {
  id: string;
  name: string;
  emoji: string;
  pricePerMonth: number;
};

const RITMOS: RitmoOption[] = [
  { id: "viajero", name: "Viajero", emoji: "🌍", pricePerMonth: 240 },
  { id: "estandar", name: "Estandar", emoji: "⭐", pricePerMonth: 320 },
  { id: "intensivo", name: "Intensivo", emoji: "🔥", pricePerMonth: 450 },
  { id: "vip_express", name: "VIP Express", emoji: "🚀", pricePerMonth: 690 },
];

type Props = {
  leadId: string;
  leadName: string;
  onOpenSendOffer: () => void;
};

type ActiveAction =
  | null
  | { type: "simple"; action: string; label: string }
  | { type: "ritmo_picker" }
  | { type: "fecha_picker" }
  | { type: "copy_panel"; action: string; label: string; message: string };

type ActionButton = {
  action: string;
  label: string;
  icon: string;
  description: string;
  isCopy?: boolean;
  needsRitmo?: boolean;
  needsFecha?: boolean;
  isLink?: boolean;
};

const ACTION_BUTTONS: ActionButton[] = [
  { action: "agendar", label: "Agendar", icon: "📅", description: "Iniciar cadena de agendamiento" },
  { action: "no_contesto", label: "No contesto", icon: "📵", description: "Cadena de seguimiento", isCopy: true },
  { action: "enviar_info", label: "Enviar info", icon: "📋", description: "Info de cursos", isCopy: true },
  { action: "enviar_propuesta", label: "Propuesta", icon: "💰", description: "Seleccionar ritmo", needsRitmo: true },
  { action: "seguimiento_fecha", label: "Seguimiento", icon: "📆", description: "Programar seguimiento", needsFecha: true },
  { action: "enviar_enlace", label: "Enlace", icon: "🔗", description: "Enlace de inscripcion", isLink: true },
  { action: "confirmar_pago", label: "Confirmar pago", icon: "✅", description: "Verificar pago" },
  { action: "pasar_reactivacion", label: "Reactivacion", icon: "🔄", description: "Pasar a reactivacion", isCopy: true },
];

export function Layer2Actions({ leadId, leadName, onOpenSendOffer }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [activeAction, setActiveAction] = useState<ActiveAction>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedRitmo, setSelectedRitmo] = useState<string | null>(null);
  const [fecha, setFecha] = useState("");
  const [nota, setNota] = useState("");

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

  const fetchTemplate = async (action: string, label: string) => {
    setError(null);
    const res = await fetch(`/api/closer/leads/${leadId}/layer2`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body?.error ?? "Error");
      return;
    }
    const data = await res.json();
    setActiveAction({ type: "copy_panel", action, label, message: data.message ?? `Accion "${label}" ejecutada. Abre WhatsApp para enviar el mensaje.` });
    router.refresh();
  };

  const handleClick = (btn: ActionButton) => {
    if (btn.isLink) {
      onOpenSendOffer();
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
      executeAction(btn.action);
      return;
    }
    executeAction(btn.action);
  };

  const handleRitmoSubmit = () => {
    if (!selectedRitmo) return;
    executeAction("enviar_propuesta", { ritmoId: selectedRitmo });
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
          setActiveAction(null);
          router.refresh();
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
              disabled={pending}
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
            disabled={!selectedRitmo || pending}
            className="w-full btn-primary disabled:opacity-50"
          >
            {pending ? "Enviando..." : "Enviar propuesta"}
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
    </section>
  );
}
