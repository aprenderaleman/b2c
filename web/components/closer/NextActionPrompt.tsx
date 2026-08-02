"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type Props = {
  leadId: string;
  leadName: string;
  onDismiss: () => void;
};

const NEXT_ACTIONS = [
  { action: "no_contesto", label: "Seguimiento", icon: "\u{1f4f5}", isCopy: true },
  { action: "enviar_propuesta", label: "Propuesta", icon: "\u{1f4b0}", isCopy: false },
  { action: "seguimiento_fecha", label: "Seguimiento fecha", icon: "\u{1f4c6}", isCopy: false },
  { action: "pasar_reactivacion", label: "Reactivacion", icon: "\u{1f504}", isCopy: true },
] as const;

export function NextActionPrompt({ leadId, leadName, onDismiss }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleAction = (action: string) => {
    setError(null);
    startTransition(async () => {
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
      router.refresh();
      onDismiss();
    });
  };

  return (
    <div className="rounded-2xl border-2 border-dashed border-brand-300 dark:border-brand-500/40 bg-brand-50/50 dark:bg-brand-500/5 p-4 space-y-3">
      <div>
        <p className="text-sm font-semibold text-brand-800 dark:text-brand-200">
          Sin tareas pendientes para {leadName}
        </p>
        <p className="text-xs text-brand-600 dark:text-brand-400">
          Que sigue?
        </p>
      </div>

      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

      <div className="flex flex-wrap gap-1.5">
        {NEXT_ACTIONS.map((a) => (
          <button
            key={a.action}
            onClick={() => handleAction(a.action)}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-full border border-brand-200 dark:border-brand-500/30 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-brand-700 dark:text-brand-300 hover:bg-brand-50 dark:hover:bg-brand-500/10 transition-colors disabled:opacity-50"
          >
            <span>{a.icon}</span>
            {a.label}
          </button>
        ))}
        <button
          onClick={onDismiss}
          className="inline-flex items-center rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
        >
          Nada
        </button>
      </div>
    </div>
  );
}
