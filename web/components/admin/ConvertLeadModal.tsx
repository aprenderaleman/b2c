"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type Lead = {
  id:    string;
  name:  string;
  email: string | null;
  phone: string;
  language:     "es" | "de";
  german_level: string;
  goal:         string | null;
};

const CEFR_LEVELS = ["A0", "A1", "A2", "B1", "B2", "C1", "C2"] as const;

/**
 * Map the funnel's coarse german_level (A0, A1-A2, B1, B2+) to a single
 * CEFR level for the student record. Admin can override in the form.
 */
function defaultLevelFrom(lead: Lead): typeof CEFR_LEVELS[number] {
  switch (lead.german_level) {
    case "A0":    return "A0";
    case "A1-A2": return "A1";
    case "B1":    return "B1";
    case "B2+":   return "B2";
    default:      return "A0";
  }
}

type Props = {
  lead: Lead;
  open: boolean;
  onClose: () => void;
};

export function ConvertLeadModal({ lead, open, onClose }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [email,            setEmail]            = useState(lead.email ?? "");
  const [fullName,         setFullName]         = useState(lead.name);
  const [currentLevel,     setCurrentLevel]     = useState<typeof CEFR_LEVELS[number]>(defaultLevelFrom(lead));
  const [subscriptionType, setSubscriptionType] = useState<
    "single_classes" | "package" | "monthly_subscription" | "combined"
  >("package");
  const [classesRemaining,  setClassesRemaining]  = useState<number>(20);
  const [classesPerMonth,   setClassesPerMonth]   = useState<number>(4);
  const [monthlyPriceEuros, setMonthlyPriceEuros] = useState<number>(200);
  const [goal,              setGoal]              = useState(lead.goal ?? "");

  const needsEmail = !email.trim();

  if (!open) return null;

  const submit = () => {
    setError(null);
    if (needsEmail) {
      setError("El correo del lead es obligatorio. Pídeselo por WhatsApp si aún no lo tienes.");
      return;
    }

    startTransition(async () => {
      const payload = {
        email,
        fullName,
        phone: lead.phone,
        language: lead.language,

        currentLevel,
        goal: goal || null,

        subscriptionType,
        classesRemaining:  subscriptionType === "monthly_subscription" ? 0 : classesRemaining,
        classesPerMonth:   subscriptionType === "monthly_subscription" ? classesPerMonth : null,
        monthlyPriceEuros: subscriptionType === "monthly_subscription" ? monthlyPriceEuros : null,
        currency: "EUR",
      };

      const res = await fetch(`/api/admin/leads/${lead.id}/convert`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.message ?? body?.error ?? "Error al convertir. Inténtalo de nuevo.");
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
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-50">
            Convertir en estudiante
          </h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Se creará el usuario, se enviará el email de bienvenida con sus accesos y un WhatsApp.
          </p>
        </header>

        <div className="p-6 space-y-4">
          {/* Identity */}
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Nombre completo">
              <input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="input-text"
                maxLength={120}
              />
            </Field>
            <Field label="WhatsApp (sólo lectura)">
              <input
                value={lead.phone}
                disabled
                className="input-text opacity-70 cursor-not-allowed font-mono text-sm"
              />
            </Field>
          </div>

          <Field
            label="Correo electrónico"
            hint={needsEmail ? "Obligatorio — pídeselo al lead si aún no lo tienes" : undefined}
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

          {/* Academic */}
          <div className="grid sm:grid-cols-2 gap-4">
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
            <Field label="Meta (opcional)">
              <input
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                placeholder="p.ej. pasar B1 en 6 meses"
                className="input-text"
                maxLength={300}
              />
            </Field>
          </div>

          {/* Plan */}
          <Field label="Tipo de plan">
            <select
              value={subscriptionType}
              onChange={(e) => setSubscriptionType(e.target.value as typeof subscriptionType)}
              className="input-text"
            >
              <option value="package">Paquete de clases</option>
              <option value="monthly_subscription">Suscripción mensual</option>
              <option value="single_classes">Clases sueltas</option>
              <option value="combined">Combinado</option>
            </select>
          </Field>

          {subscriptionType === "monthly_subscription" ? (
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Clases al mes">
                <input
                  type="number" min={1} max={100}
                  value={classesPerMonth}
                  onChange={(e) => setClassesPerMonth(Number(e.target.value))}
                  className="input-text"
                />
              </Field>
              <Field label="Precio mensual (€)">
                <input
                  type="number" min={0} step="0.01"
                  value={monthlyPriceEuros}
                  onChange={(e) => setMonthlyPriceEuros(Number(e.target.value))}
                  className="input-text"
                />
              </Field>
            </div>
          ) : (
            <Field label="Clases contratadas">
              <input
                type="number" min={0} max={500}
                value={classesRemaining}
                onChange={(e) => setClassesRemaining(Number(e.target.value))}
                className="input-text"
              />
            </Field>
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
            disabled={pending || needsEmail}
          >
            {pending ? "Convirtiendo…" : "Convertir en estudiante"}
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
