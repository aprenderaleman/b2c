"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { TRIAL_PACKS, type PackId } from "@/lib/trial-packs";

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

function defaultLevelFrom(lead: Lead): typeof CEFR_LEVELS[number] {
  switch (lead.german_level) {
    case "A0":    return "A0";
    case "A1.1":  return "A1";
    case "A1.2":  return "A1";
    case "A1-A2": return "A1";
    case "A2.1":  return "A2";
    case "A2.2":  return "A2";
    case "B1":    return "B1";
    case "B2":    return "B2";
    case "B2+":   return "B2";
    default:      return "A0";
  }
}

type Props = {
  lead: Lead;
  open: boolean;
  onClose: () => void;
  convertEndpoint?: string;
};

export function ConvertLeadModal({ lead, open, onClose, convertEndpoint }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [email,        setEmail]        = useState(lead.email ?? "");
  const [fullName,     setFullName]     = useState(lead.name);
  const [currentLevel, setCurrentLevel] = useState<typeof CEFR_LEVELS[number]>(defaultLevelFrom(lead));
  const [packId,       setPackId]       = useState<PackId | "">("");
  const [horarios,     setHorarios]     = useState("");

  const needsEmail = !email.trim();
  const needsPack  = packId === "";

  if (!open) return null;

  const selectedPack = TRIAL_PACKS.find(p => p.id === packId);

  const submit = () => {
    setError(null);
    if (needsEmail) {
      setError("El correo del lead es obligatorio. Pideselo por WhatsApp si aun no lo tienes.");
      return;
    }
    if (needsPack) {
      setError("Selecciona un pack.");
      return;
    }

    startTransition(async () => {
      const payload = {
        email,
        fullName,
        phone: lead.phone,
        language: lead.language,
        currentLevel,
        goal: lead.goal || null,
        subscriptionType: "package" as const,
        classesRemaining: selectedPack?.classes ?? 32,
        horarios: horarios.trim() || null,
        packId,
        currency: "EUR",
      };

      const res = await fetch(convertEndpoint ?? `/api/admin/leads/${lead.id}/convert`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.message ?? body?.error ?? "Error al convertir. Intentalo de nuevo.");
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
            Se creara el usuario, se enviara el email de bienvenida con sus accesos y un WhatsApp.
          </p>
        </header>

        <div className="p-6 space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Nombre completo">
              <input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="input-text"
                maxLength={120}
              />
            </Field>
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
          </div>

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
            <Field label="Pack">
              <select
                value={packId}
                onChange={(e) => setPackId(e.target.value as PackId)}
                className="input-text"
              >
                <option value="">— Selecciona —</option>
                {TRIAL_PACKS.map(p => (
                  <option key={p.id} value={p.id}>{p.name} ({p.classes} clases)</option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="Horarios">
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
            disabled={pending || needsEmail || needsPack}
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
