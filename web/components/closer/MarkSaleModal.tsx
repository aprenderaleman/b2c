"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { TRIAL_PACKS, type PackId } from "@/lib/trial-packs";

type Props = {
  leadId: string;
  onClose: () => void;
  endpoint?: string;
};

export function MarkSaleModal({ leadId, onClose, endpoint }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [packId, setPackId] = useState<PackId>(TRIAL_PACKS[0].id);
  const [paymentType, setPaymentType] = useState<"single" | "flexible" | "extended">("single");

  const selectedPack = TRIAL_PACKS.find((p) => p.id === packId) ?? TRIAL_PACKS[0];
  const montoCents = selectedPack.priceCents;

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const url = endpoint ?? `/api/closer/leads/${leadId}/mark-sale`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packId, paymentType, montoCents }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.message ?? body?.error ?? "Error al marcar venta");
        return;
      }
      onClose();
      router.refresh();
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-lg rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl max-h-[90vh] overflow-y-auto">
        <header className="px-6 py-5 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">
            Marcar venta
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Selecciona el pack y tipo de pago. La venta queda pendiente de aprobacion del admin.
          </p>
        </header>

        <div className="p-6 space-y-4">
          <label className="block">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Pack</span>
            <select
              value={packId}
              onChange={(e) => setPackId(e.target.value as PackId)}
              className="input-text mt-1"
            >
              {TRIAL_PACKS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({(p.priceCents / 100).toLocaleString("es")} EUR)
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Tipo de pago</span>
            <select
              value={paymentType}
              onChange={(e) => setPaymentType(e.target.value as "single" | "flexible" | "extended")}
              className="input-text mt-1"
            >
              <option value="single">{selectedPack.labels.single}</option>
              <option value="flexible">{selectedPack.labels.flexible}</option>
              {selectedPack.labels.extended && (
                <option value="extended">{selectedPack.labels.extended}</option>
              )}
            </select>
          </label>

          <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/60 p-4">
            <p className="text-sm text-slate-700 dark:text-slate-300">
              Monto: <strong>{(montoCents / 100).toLocaleString("es")} EUR</strong>
            </p>
          </div>

          {error && <p className="text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>}
        </div>

        <footer className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-3">
          <button onClick={onClose} className="btn-secondary">Cancelar</button>
          <button onClick={submit} disabled={pending} className="btn-primary">
            {pending ? "Enviando..." : "Enviar para aprobacion"}
          </button>
        </footer>
      </div>
    </div>
  );
}
