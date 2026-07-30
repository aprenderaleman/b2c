"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  RITMOS, ONE_TIME_PACKS, KIDS_PACK, buildSubscriptionUrl,
  type RitmoId, type GoalId, type PlanCategory,
} from "@/lib/trial-packs";

type KidsPayment = "single" | "flexible";

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
  const [nivel, setNivel] = useState(defaultLevel || "");
  const [category, setCategory] = useState<PlanCategory | "">("");
  const [ritmoId, setRitmoId] = useState<RitmoId | "">("");
  const [goalId, setGoalId] = useState<GoalId | "">("");
  const [kidsPayment, setKidsPayment] = useState<KidsPayment>("single");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();

  const selectedRitmo = ritmoId ? RITMOS.find(r => r.id === ritmoId) : null;
  const selectedGoal = selectedRitmo && goalId
    ? selectedRitmo.goals.find(g => g.id === goalId)
    : null;
  const selectedOneTime = category === "one_time" && goalId
    ? ONE_TIME_PACKS.find(p => p.id === goalId)
    : null;

  // Compute packId for the API
  const packId =
    category === "subscription" && ritmoId ? ritmoId :
    category === "one_time" && goalId ? goalId :
    category === "kids" ? "kids" : "";

  const canSubmit =
    (category === "subscription" && ritmoId && goalId) ||
    (category === "one_time" && goalId) ||
    category === "kids";

  // Summary line
  const summaryLine = (() => {
    if (category === "subscription" && selectedRitmo && selectedGoal) {
      return `${selectedRitmo.emoji} ${selectedRitmo.name} · Meta ${selectedGoal.label} · ${selectedGoal.months} meses · ${(selectedGoal.totalCents / 100).toLocaleString("es-ES")} € total`;
    }
    if (category === "one_time" && selectedOneTime) {
      return `${selectedOneTime.name} · ${(selectedOneTime.priceCents / 100).toLocaleString("es-ES")} €`;
    }
    if (category === "kids") {
      const label = kidsPayment === "single" ? KIDS_PACK.labels.single : KIDS_PACK.labels.flexible;
      return `Pack Kids · ${label}`;
    }
    return null;
  })();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    startTransition(async () => {
      try {
        const paymentType =
          category === "kids" ? kidsPayment :
          category === "subscription" ? "flexible" : "single";
        const res = await fetch(`/api/teacher/trial/${leadId}/attended`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            packId,
            paymentType,
            ...(goalId && category !== "kids" ? { goal: goalId } : {}),
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
        El lead recibira el enlace de Stripe del plan seleccionado por email.
      </p>

      <form onSubmit={submit} className="mt-5 space-y-4">
        {/* Nivel */}
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

        {/* Tipo de plan */}
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            Tipo de plan <span className="text-rose-500">*</span>
          </label>
          <select
            value={category}
            onChange={(e) => {
              const v = e.target.value as PlanCategory | "";
              setCategory(v);
              setRitmoId("");
              setGoalId("");
            }}
            className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-400"
          >
            <option value="">— Selecciona —</option>
            <option value="subscription">Suscripcion mensual</option>
            <option value="one_time">Pago unico por meta</option>
            <option value="kids">Pack Kids</option>
          </select>
        </div>

        {/* Ritmo (solo suscripciones) */}
        {category === "subscription" && (
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              Ritmo <span className="text-rose-500">*</span>
            </label>
            <select
              value={ritmoId}
              onChange={(e) => {
                setRitmoId(e.target.value as RitmoId);
                setGoalId("");
              }}
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-400"
            >
              <option value="">— Selecciona ritmo —</option>
              {RITMOS.map(r => (
                <option key={r.id} value={r.id}>
                  {r.emoji} {r.name} ({r.classesPerMonth} clases/mes · {r.pricePerMonth} €/mes)
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Meta (suscripciones con ritmo seleccionado, o pago único) */}
        {(category === "subscription" && ritmoId && selectedRitmo) && (
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              Meta <span className="text-rose-500">*</span>
            </label>
            <select
              value={goalId}
              onChange={(e) => setGoalId(e.target.value as GoalId)}
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-400"
            >
              <option value="">— Selecciona meta —</option>
              {selectedRitmo.goals.map(g => (
                <option key={g.id} value={g.id}>
                  {g.label} — {g.months} meses · {(g.totalCents / 100).toLocaleString("es-ES")} € total
                </option>
              ))}
            </select>
          </div>
        )}

        {category === "one_time" && (
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              Meta <span className="text-rose-500">*</span>
            </label>
            <select
              value={goalId}
              onChange={(e) => setGoalId(e.target.value as GoalId)}
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-400"
            >
              <option value="">— Selecciona meta —</option>
              {ONE_TIME_PACKS.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name} — {(p.priceCents / 100).toLocaleString("es-ES")} €
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Kids payment type */}
        {category === "kids" && (
          <div>
            <span className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              Tipo de pago
            </span>
            <div className="mt-2 flex flex-col gap-2">
              {([
                { v: "single" as const, label: KIDS_PACK.labels.single },
                { v: "flexible" as const, label: KIDS_PACK.labels.flexible },
              ]).map(opt => (
                <label
                  key={opt.v}
                  className={`cursor-pointer rounded-lg border px-3 py-2 text-sm ${
                    kidsPayment === opt.v
                      ? "border-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-900 dark:text-emerald-200"
                      : "border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300"
                  }`}
                >
                  <input
                    type="radio"
                    name="kidsPayment"
                    value={opt.v}
                    checked={kidsPayment === opt.v}
                    onChange={() => setKidsPayment(opt.v)}
                    className="sr-only"
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Summary */}
        {summaryLine && (
          <div className="rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm text-slate-700 dark:text-slate-300">
            {summaryLine}
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
