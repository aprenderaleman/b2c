"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

/**
 * When a teacher leaves the aula, we bounce them back to the class detail
 * with ?end=1. This modal shows the auto-calculated duration and lets
 * them confirm. No manual input — the timer is the source of truth.
 */
export function EndClassModal({
  classId, suggestedMinutes, scheduledDuration,
}: {
  classId: string;
  suggestedMinutes: number;
  scheduledDuration: number;
}) {
  const sp = useSearchParams();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (sp.get("end") === "1") setOpen(true);
  }, [sp]);

  if (!open) return null;

  const close = () => {
    setOpen(false);
    const params = new URLSearchParams(sp.toString());
    params.delete("end");
    router.replace(`?${params.toString()}`);
  };

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/aula/${classId}/end`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({}),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.message ?? body?.error ?? "No se pudo guardar.");
        return;
      }
      close();
      router.refresh();
    });
  };

  const displayMinutes = suggestedMinutes || scheduledDuration;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-md rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl">
        <header className="px-6 py-5 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-50">
            Finalizar clase
          </h2>
        </header>
        <div className="p-6 space-y-4">
          <div className="text-center">
            <p className="text-4xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
              {displayMinutes} min
            </p>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              Duración registrada por el sistema
            </p>
          </div>
          {error && <p className="text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>}
        </div>
        <footer className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-3">
          <button type="button" className="btn-secondary" onClick={close} disabled={pending}>
            Cancelar
          </button>
          <button type="button" className="btn-primary" onClick={submit} disabled={pending}>
            {pending ? "Guardando..." : "Confirmar y cerrar"}
          </button>
        </footer>
      </div>
    </div>
  );
}
