"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  RITMOS,
  ONE_TIME_PACKS,
  KIDS_PACK,
  type RitmoId,
  type GoalId,
} from "@/lib/trial-packs";

type PlanCategory = "subscription" | "one_time" | "kids";

const CEFR_LEVELS = ["A0", "A1", "A2", "B1", "B2", "C1", "C2"] as const;

const ONE_TIME_CLASSES: Record<GoalId, number> = {
  a1_a2: 36,
  b1: 48,
  b2: 48,
  c1: 60,
  fluidez_total: 96,
};

function defaultLevelFrom(level: string | null | undefined): typeof CEFR_LEVELS[number] {
  if (!level) return "A0";
  if (level.startsWith("A1")) return "A1";
  if (level.startsWith("A2")) return "A2";
  if (level.startsWith("B1")) return "B1";
  if (level.startsWith("B2")) return "B2";
  if (level.startsWith("C1")) return "C1";
  if (level.startsWith("C2")) return "C2";
  return "A0";
}

type Props = {
  leadId: string;
  leadName: string;
  leadEmail: string | null;
  leadPhone: string | null;
  leadLanguage: "es" | "de";
  leadGermanLevel: string | null;
  leadGoal: string | null;
  onClose: () => void;
};

export function ConfirmPaymentModal({
  leadId,
  leadName,
  leadEmail,
  leadPhone,
  leadLanguage,
  leadGermanLevel,
  leadGoal,
  onClose,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [category, setCategory] = useState<PlanCategory>("subscription");
  const [ritmoId, setRitmoId] = useState<RitmoId>("viajero");
  const [goalId, setGoalId] = useState<GoalId>("a1_a2");
  const [oneTimeGoal, setOneTimeGoal] = useState<GoalId>("a1_a2");
  const [currentLevel, setCurrentLevel] = useState(defaultLevelFrom(leadGermanLevel));
  const [email, setEmail] = useState(leadEmail ?? "");
  const [horarios, setHorarios] = useState("");

  const selectedRitmo = RITMOS.find(r => r.id === ritmoId)!;
  const selectedGoal = selectedRitmo.goals.find(g => g.id === goalId);
  const selectedOneTime = ONE_TIME_PACKS.find(p => p.id === oneTimeGoal);

  const needsEmail = !email.trim();

  const summary = (() => {
    if (category === "subscription" && selectedGoal) {
      const totalClasses = selectedRitmo.classesPerMonth * selectedGoal.months;
      return {
        classes: totalClasses,
        detail: `${selectedRitmo.classesPerMonth} clases/mes x ${selectedGoal.months} meses = ${totalClasses} clases`,
        price: `${selectedRitmo.pricePerMonth}€/mes | Total: ${(selectedGoal.totalCents / 100).toLocaleString("es-ES")}€`,
      };
    }
    if (category === "one_time" && selectedOneTime) {
      const classes = ONE_TIME_CLASSES[oneTimeGoal];
      return {
        classes,
        detail: `${classes} clases incluidas`,
        price: `Pago unico: ${(selectedOneTime.priceCents / 100).toLocaleString("es-ES")}€`,
      };
    }
    if (category === "kids") {
      return {
        classes: KIDS_PACK.classes,
        detail: `${KIDS_PACK.classes} clases incluidas`,
        price: `${(KIDS_PACK.priceCents / 100).toLocaleString("es-ES")}€`,
      };
    }
    return null;
  })();

  const submit = () => {
    setError(null);
    if (needsEmail) {
      setError("El correo del lead es obligatorio. Pideselo por WhatsApp si aun no lo tienes.");
      return;
    }

    startTransition(async () => {
      try {
        let packId: string;
        let subscriptionType: string;
        let classesRemaining: number;
        let classesPerMonth: number | null = null;
        let monthlyPriceEuros: number | null = null;

        if (category === "subscription") {
          packId = ritmoId;
          subscriptionType = "monthly_subscription";
          classesRemaining = summary!.classes;
          classesPerMonth = selectedRitmo.classesPerMonth;
          monthlyPriceEuros = selectedRitmo.pricePerMonth;
        } else if (category === "one_time") {
          packId = oneTimeGoal;
          subscriptionType = "package";
          classesRemaining = ONE_TIME_CLASSES[oneTimeGoal];
        } else {
          packId = "kids";
          subscriptionType = "package";
          classesRemaining = KIDS_PACK.classes;
        }

        const res = await fetch(`/api/teacher/trial/${leadId}/confirm-payment`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email,
            fullName: leadName,
            phone: leadPhone,
            language: leadLanguage,
            currentLevel,
            goal: leadGoal || null,
            subscriptionType,
            classesRemaining,
            classesPerMonth,
            monthlyPriceEuros,
            currency: "EUR",
            horarios: horarios.trim() || null,
            packId,
            paymentType: category === "subscription" ? "single" : "single",
          }),
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          if (res.status === 409) {
            setError("Este lead ya fue convertido a estudiante.");
          } else {
            setError(body?.message ?? body?.error ?? "Error al confirmar. Intentalo de nuevo.");
          }
          return;
        }

        onClose();
        router.refresh();
      } catch {
        setError("Error de red. Intentalo de nuevo.");
      }
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
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-50">
            Confirmar Pago
          </h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Se creara el usuario, se enviara email de bienvenida con accesos y un WhatsApp.
          </p>
        </header>

        <div className="p-6 space-y-5">
          {/* Level */}
          <Field label="Nivel actual">
            <select
              value={currentLevel}
              onChange={(e) => setCurrentLevel(e.target.value as typeof CEFR_LEVELS[number])}
              className="input-text"
            >
              {CEFR_LEVELS.map((lvl) => (
                <option key={lvl} value={lvl}>{lvl}</option>
              ))}
            </select>
          </Field>

          {/* Plan category */}
          <div>
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
              Tipo de plan
            </span>
            <div className="mt-2 flex flex-wrap gap-2">
              {([
                { id: "subscription" as const, label: "Suscripcion mensual", emoji: "📅" },
                { id: "one_time" as const,     label: "Pago unico",         emoji: "💳" },
                { id: "kids" as const,         label: "Kids",               emoji: "👶" },
              ]).map(({ id, label, emoji }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setCategory(id)}
                  className={`text-sm font-semibold rounded-xl border px-4 py-2 transition-colors ${
                    category === id
                      ? "border-emerald-400 bg-emerald-50 dark:bg-emerald-500/15 text-emerald-800 dark:text-emerald-200"
                      : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
                  }`}
                >
                  {emoji} {label}
                </button>
              ))}
            </div>
          </div>

          {/* Subscription: ritmo + goal */}
          {category === "subscription" && (
            <div className="space-y-4 rounded-xl border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50/50 dark:bg-emerald-500/5 p-4">
              <Field label="Ritmo">
                <select
                  value={ritmoId}
                  onChange={(e) => {
                    const id = e.target.value as RitmoId;
                    setRitmoId(id);
                    const ritmo = RITMOS.find(r => r.id === id)!;
                    if (!ritmo.goals.find(g => g.id === goalId)) {
                      setGoalId(ritmo.goals[0].id);
                    }
                  }}
                  className="input-text"
                >
                  {RITMOS.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.emoji} {r.name} ({r.classesPerMonth} cls/mes — {r.pricePerMonth}€/mes)
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Meta">
                <select
                  value={goalId}
                  onChange={(e) => setGoalId(e.target.value as GoalId)}
                  className="input-text"
                >
                  {selectedRitmo.goals.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.label} ({g.months} meses)
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

          {/* One-time: goal */}
          {category === "one_time" && (
            <div className="space-y-4 rounded-xl border border-blue-200 dark:border-blue-500/30 bg-blue-50/50 dark:bg-blue-500/5 p-4">
              <Field label="Pack">
                <select
                  value={oneTimeGoal}
                  onChange={(e) => setOneTimeGoal(e.target.value as GoalId)}
                  className="input-text"
                >
                  {ONE_TIME_PACKS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({(p.priceCents / 100).toLocaleString("es-ES")}€)
                    </option>
                  ))}
                </select>
              </Field>

              {summary && (
                <div className="text-xs text-blue-700 dark:text-blue-300 space-y-0.5">
                  <p>{summary.detail}</p>
                  <p className="font-semibold">{summary.price}</p>
                </div>
              )}
            </div>
          )}

          {/* Kids */}
          {category === "kids" && summary && (
            <div className="rounded-xl border border-amber-200 dark:border-amber-500/30 bg-amber-50/50 dark:bg-amber-500/5 p-4">
              <div className="text-xs text-amber-700 dark:text-amber-300 space-y-0.5">
                <p>👶 Pack Kids</p>
                <p>{summary.detail}</p>
                <p className="font-semibold">{summary.price}</p>
              </div>
            </div>
          )}

          {/* Email */}
          <Field
            label="Correo electronico"
            hint={needsEmail ? "Obligatorio — pideselo al lead" : undefined}
          >
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="alumno@correo.com"
              className="input-text"
              autoFocus={needsEmail}
            />
          </Field>

          {/* Horarios */}
          <Field label="Horarios preferidos">
            <input
              value={horarios}
              onChange={(e) => setHorarios(e.target.value)}
              placeholder='Ej: "Lunes y miercoles 18:00 CET"'
              className="input-text"
              maxLength={300}
            />
          </Field>

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
            disabled={pending || needsEmail}
          >
            {pending ? "Procesando…" : "Confirmar Pago"}
          </button>
        </footer>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: {
  label: string; hint?: string; children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
        {label}
      </span>
      <div className="mt-1">{children}</div>
      {hint && (
        <span className="mt-1 block text-xs text-amber-700 dark:text-amber-300">
          {hint}
        </span>
      )}
    </label>
  );
}
