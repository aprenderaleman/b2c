"use client";

import { useState, useTransition } from "react";
import { TRIAL_PACKS, type PackId, type PaymentType } from "@/lib/trial-packs";

/**
 * Modal que se abre al pulsar "✓ Asistió" en la página del lead.
 *
 * Captura tres cosas antes de mandar el follow-up:
 *   1. Objetivo del lead (texto libre — lo que nos contó en clase)
 *   2. Pack recomendado (de la lista en lib/trial-packs.ts)
 *   3. Tipo de pago (único o flexible)
 *
 * Al confirmar, POSTea JSON a /api/admin/leads/{id}/trial/attended.
 * El backend manda el WhatsApp personalizado con el link del pack
 * correspondiente al tipo de pago.
 */
export function MarkAttendedModal({
  leadId, leadName, onClose, onSuccess,
}: {
  leadId:    string;
  leadName:  string;
  onClose:   () => void;
  onSuccess: () => void;
}) {
  const [objective,   setObjective]   = useState("");
  const [packId,      setPackId]      = useState<PackId | "">("");
  const [paymentType, setPaymentType] = useState<PaymentType>("single");
  const [nivel,       setNivel]       = useState("");
  const [error,       setError]       = useState<string | null>(null);
  const [pending,     startTransition] = useTransition();

  const canSubmit = objective.trim().length >= 3 && packId !== "";

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) {
      setError("Completa el objetivo y el pack antes de continuar.");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/admin/leads/${leadId}/trial/attended`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ objective: objective.trim(), packId, paymentType, ...(nivel ? { nivel } : {}) }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error || `HTTP ${res.status}`);
        }
        onSuccess();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error al marcar asistencia.");
      }
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 p-6 shadow-2xl border border-slate-200 dark:border-slate-700"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          Marcar asistencia · {leadName}
        </h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Estos datos personalizan el WhatsApp post-clase que recibe el lead.
        </p>

        <form onSubmit={submit} className="mt-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              Objetivo del lead <span className="text-rose-500">*</span>
            </label>
            <textarea
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
              rows={2}
              placeholder='Ej: "Mudarse a Berlín en 6 meses por trabajo"'
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-400"
              required
            />
            <p className="mt-1 text-xs text-slate-500">
              Lo citaremos en el mensaje al lead (entre comillas).
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              Pack recomendado <span className="text-rose-500">*</span>
            </label>
            <select
              value={packId}
              onChange={(e) => setPackId(e.target.value as PackId)}
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-400"
              required
            >
              <option value="">— Selecciona un pack —</option>
              {TRIAL_PACKS.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            {packId && (
              <p className="mt-1 text-xs text-slate-500">
                Link según pago elegido: {paymentType === "single" ? "pago único" : "flexible (mensualidades)"}.
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              Nivel del pack
            </label>
            <select
              value={nivel}
              onChange={(e) => setNivel(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-400"
            >
              <option value="">— Sin especificar —</option>
              {["A1", "A2", "B1", "B2", "C1"].map(n => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
            <p className="mt-1 text-xs text-slate-500">
              Se incluye en el mensaje de WhatsApp junto al nombre del pack.
            </p>
          </div>

          <div>
            <span className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              Tipo de pago preferido <span className="text-rose-500">*</span>
            </span>
            <p className="mt-0.5 text-xs text-slate-500">
              Nota interna para el CRM — el WhatsApp lleva un solo link y el lead elige en la landing.
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {([
                { v: "single",   label: "Pago único", hint: "Descuento por pago anticipado" },
                { v: "flexible", label: "Pago flexible", hint: "Mensualidades" },
              ] as const).map(opt => (
                <label
                  key={opt.v}
                  className={`cursor-pointer rounded-lg border px-3 py-2 text-sm ${
                    paymentType === opt.v
                      ? "border-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-900 dark:text-emerald-200"
                      : "border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300"
                  }`}
                >
                  <input
                    type="radio"
                    name="paymentType"
                    value={opt.v}
                    checked={paymentType === opt.v}
                    onChange={() => setPaymentType(opt.v)}
                    className="sr-only"
                  />
                  <div className="font-medium">{opt.label}</div>
                  <div className="text-xs opacity-70">{opt.hint}</div>
                </label>
              ))}
            </div>
          </div>

          {error && (
            <div className="rounded-lg bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 px-3 py-2 text-sm text-rose-700 dark:text-rose-300">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={pending}
              className="text-sm rounded-full border border-slate-300 dark:border-slate-600 px-4 py-1.5 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!canSubmit || pending}
              className="text-sm font-semibold rounded-full border border-emerald-400 bg-emerald-500 text-white px-4 py-1.5 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {pending ? "Enviando..." : "✓ Marcar asistió y enviar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
