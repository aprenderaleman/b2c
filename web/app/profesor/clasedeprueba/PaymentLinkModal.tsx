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

  const selectedPack = packId ? TRIAL_PACKS.find(p => p.id === packId) : null;
  const paymentOptions: { v: PaymentType; label: string }[] = selectedPack
    ? [
        { v: "single",   label: selectedPack.labels.single },
        { v: "flexible",  label: selectedPack.labels.flexible },
        ...(selectedPack.labels.extended
          ? [{ v: "extended" as const, label: selectedPack.labels.extended }]
          : []),
      ]
    : [
        { v: "single",   label: "Pago único" },
        { v: "flexible",  label: "Flexible" },
      ];
  const [error, setError]           = useState<string | null>(null);
  const [sent, setSent]             = useState(false);
  const [pending, startTransition]  = useTransition();

  const canSubmit = packId !== "";

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
            {leadName} recibio el enlace de inscripcion por WhatsApp y email.
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
        Enviar enlace de inscripcion · {leadName}
      </h2>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
        El lead recibira el enlace de Stripe del pack seleccionado por email.
      </p>

      <form onSubmit={submit} className="mt-5 space-y-4">
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
              onChange={(e) => {
                const newId = e.target.value as PackId;
                setPackId(newId);
                setPaymentType("single");
              }}
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-400"
            >
              <option value="">— Selecciona —</option>
              <optgroup label="Suscripciones mensuales">
                {TRIAL_PACKS.filter(p => p.category === "monthly").map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </optgroup>
              <optgroup label="Pagos únicos por meta">
                {TRIAL_PACKS.filter(p => p.category === "goal").map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </optgroup>
              <optgroup label="Otros">
                {TRIAL_PACKS.filter(p => p.category === "other").map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </optgroup>
            </select>
          </div>
        </div>

        {selectedPack && selectedPack.urlSingle !== selectedPack.urlFlexible && (
          <div>
            <span className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              Tipo de pago
            </span>
            <div className="mt-2 flex flex-col gap-2">
              {paymentOptions.map(opt => (
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
                  {opt.label}
                </label>
              ))}
            </div>
          </div>
        )}

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
            {pending ? "Enviando..." : "Enviar enlace de inscripcion"}
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
