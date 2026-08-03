"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  RITMOS,
  ONE_TIME_PACKS,
  type RitmoId,
  type GoalId,
} from "@/lib/trial-packs";

type PaymentMode = "flexible" | "unico";

const GOALS: { id: GoalId; label: string; emoji: string }[] = [
  { id: "a1_a2",         label: "A1-A2",         emoji: "🇩🇪" },
  { id: "b1",            label: "B1",             emoji: "📗" },
  { id: "b2",            label: "B2",             emoji: "📘" },
  { id: "c1",            label: "C1",             emoji: "📕" },
  { id: "fluidez_total", label: "Fluidez Total",  emoji: "🏆" },
];

export function PaymentLinkModal({
  leadId,
  leadName,
  onClose,
}: {
  leadId: string;
  leadName: string;
  defaultLevel?: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const [goalId, setGoalId] = useState<GoalId>("a1_a2");
  const [ritmoId, setRitmoId] = useState<RitmoId>("viajero");
  const [paymentMode, setPaymentMode] = useState<PaymentMode>("flexible");

  const selectedRitmo = RITMOS.find(r => r.id === ritmoId)!;
  const selectedGoal = selectedRitmo.goals.find(g => g.id === goalId)!;
  const selectedOneTime = ONE_TIME_PACKS.find(p => p.id === goalId);

  const summary = (() => {
    if (paymentMode === "flexible" && selectedGoal) {
      return {
        detail: `${selectedRitmo.classesPerMonth} clases/mes · Meta ${selectedGoal.label} en ${selectedGoal.months} meses`,
        price: `${selectedRitmo.pricePerMonth}€/mes`,
      };
    }
    if (paymentMode === "unico" && selectedOneTime) {
      return {
        detail: `Meta ${selectedOneTime.name}`,
        price: `Pago unico: ${(selectedOneTime.priceCents / 100).toLocaleString("es-ES")}€`,
      };
    }
    return null;
  })();

  const submit = () => {
    setError(null);
    startTransition(async () => {
      try {
        const body = paymentMode === "flexible"
          ? { category: "subscription", ritmoId, goalId }
          : { category: "one_time", goalId };

        const res = await fetch(`/api/teacher/trial/${leadId}/send-offer`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
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
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        role="dialog"
        aria-modal="true"
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      >
        <div className="w-full max-w-lg rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl p-6">
          <div className="text-center py-6">
            <div className="text-4xl mb-3">✅</div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-slate-50">
              Enlace enviado
            </h2>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              {leadName} recibio el enlace de inscripcion por WhatsApp y email.
            </p>
            <button
              onClick={onClose}
              className="btn-primary mt-5"
            >
              Cerrar
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-lg rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl max-h-[90vh] overflow-y-auto">
        <header className="px-6 py-5 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-50">
            Enviar enlace de inscripcion
          </h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {leadName} recibira el enlace de Stripe por WhatsApp y email.
          </p>
        </header>

        <div className="p-6 space-y-5">
          {/* 1. Meta / Goal */}
          <div>
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
              Meta
            </span>
            <div className="mt-2 flex flex-wrap gap-2">
              {GOALS.map(({ id, label, emoji }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setGoalId(id)}
                  className={`text-sm font-semibold rounded-xl border px-4 py-2 transition-colors ${
                    goalId === id
                      ? "border-emerald-400 bg-emerald-50 dark:bg-emerald-500/15 text-emerald-800 dark:text-emerald-200"
                      : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
                  }`}
                >
                  {emoji} {label}
                </button>
              ))}
            </div>
          </div>

          {/* 2. Tipo de pago */}
          <div>
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
              Tipo de pago
            </span>
            <div className="mt-2 flex flex-wrap gap-2">
              {([
                { id: "flexible" as const, label: "Suscripcion mensual", emoji: "📅" },
                { id: "unico" as const,    label: "Pago unico",         emoji: "💳" },
              ]).map(({ id, label, emoji }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setPaymentMode(id)}
                  className={`text-sm font-semibold rounded-xl border px-4 py-2 transition-colors ${
                    paymentMode === id
                      ? "border-emerald-400 bg-emerald-50 dark:bg-emerald-500/15 text-emerald-800 dark:text-emerald-200"
                      : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
                  }`}
                >
                  {emoji} {label}
                </button>
              ))}
            </div>
          </div>

          {/* 3. Ritmo — solo para suscripcion */}
          {paymentMode === "flexible" && (
            <div className="space-y-3 rounded-xl border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50/50 dark:bg-emerald-500/5 p-4">
              <Field label="Ritmo">
                <select
                  value={ritmoId}
                  onChange={(e) => setRitmoId(e.target.value as RitmoId)}
                  className="input-text"
                >
                  {RITMOS.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.emoji} {r.name} ({r.classesPerMonth} cls/mes — {r.pricePerMonth}€/mes)
                    </option>
                  ))}
                </select>
              </Field>

              {summary && (
                <div className="text-xs text-emerald-700 dark:text-emerald-300 space-y-0.5">
                  <p>{summary.detail}</p>
                  <p className="font-semibold">{summary.price}</p>
                </div>
              )}
            </div>
          )}

          {/* Pago unico summary */}
          {paymentMode === "unico" && summary && (
            <div className="rounded-xl border border-blue-200 dark:border-blue-500/30 bg-blue-50/50 dark:bg-blue-500/5 p-4">
              <div className="text-xs text-blue-700 dark:text-blue-300 space-y-0.5">
                <p>{summary.detail}</p>
                <p className="font-semibold">{summary.price}</p>
              </div>
            </div>
          )}

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400" role="alert">
              {error}
            </p>
          )}
        </div>

        <footer className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-3">
          <button
            type="button"
            className="btn-secondary"
            onClick={onClose}
            disabled={pending}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={submit}
            disabled={pending}
          >
            {pending ? "Enviando…" : "Enviar enlace"}
          </button>
        </footer>
      </div>
    </div>
  );
}

function Field({ label, children }: {
  label: string; children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
        {label}
      </span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
