"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { TRIAL_PACKS, type PackId, type PaymentType } from "@/lib/trial-packs";

export function PaymentLinkModal({
  leadId,
  leadName,
  defaultLevel,
  onClose,
}: {
  leadId: string;
  leadName: string;
  defaultLevel?: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [nivel, setNivel]           = useState(defaultLevel || "");
  const [packId, setPackId]         = useState<PackId | "">("");
  const [paymentType, setPaymentType] = useState<PaymentType>("single");
  const [objective, setObjective]   = useState("");
  const [error, setError]           = useState<string | null>(null);
  const [sent, setSent]             = useState(false);
  const [pending, startTransition]  = useTransition();

  const canSubmit = packId !== "" && objective.trim().length >= 3;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/teacher/trial/${leadId}/attended`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            packId,
            paymentType,
            objective: objective.trim(),
            ...(nivel ? { nivel } : {}),
          }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error || `HTTP ${res.status}`);
        }
        setSent(true);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error al enviar enlace.");
      }
    });
  };

  if (sent) {
    return (
      <Overlay onClose={onClose}>
        <div className="text-center py-8">
          <div className="text-4xl mb-3">✅</div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            Enlace enviado
          </h2>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            {leadName} recibio el enlace de pago por WhatsApp y email.
          </p>
          <button
            onClick={onClose}
            className="mt-4 text-sm font-semibold rounded-full border border-emerald-400 bg-emerald-500 text-white px-5 py-2 hover:bg-emerald-600"
          >
            Cerrar
          </button>
        </div>
      </Overlay>
    );
  }

  return (
    <Overlay onClose={onClose}>
      <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
        Enviar enlace de pago · {leadName}
      </h2>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
        El lead recibira el enlace por WhatsApp y email.
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
            placeholder='Ej: "Mudarse a Berlin en 6 meses por trabajo"'
            className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-400"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              Nivel
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
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              Pack <span className="text-rose-500">*</span>
            </label>
            <select
              value={packId}
              onChange={(e) => setPackId(e.target.value as PackId)}
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-400"
            >
              <option value="">— Selecciona —</option>
              {TRIAL_PACKS.map(p => (
                <option key={p.id} value={p.id}>{p.name} ({p.classes} clases)</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <span className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            Tipo de pago
          </span>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {([
              { v: "single" as const, label: "Pago unico" },
              { v: "flexible" as const, label: "Flexible" },
            ]).map(opt => (
              <label
                key={opt.v}
                className={`cursor-pointer rounded-lg border px-3 py-2 text-sm text-center ${
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
                {opt.label}
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
            {pending ? "Enviando..." : "Enviar enlace de pago"}
          </button>
        </div>
      </form>
    </Overlay>
  );
}

function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 p-6 shadow-2xl border border-slate-200 dark:border-slate-700"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
