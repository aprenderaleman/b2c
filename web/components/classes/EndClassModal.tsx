"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

/**
 * When a teacher leaves the aula, we bounce them back to the class detail
 * with ?end=1. This modal then opens with a suggested duration (based on
 * actual start→end timestamps) and lets them confirm or adjust.
 *
 * Posts to /api/aula/[id]/end and clears the query string on success.
 */
export function EndClassModal({
  classId, suggestedMinutes, scheduledDuration,
}: {
  classId: string;
  suggestedMinutes: number;       // computed server-side from started_at/now
  scheduledDuration: number;      // fall back display for the teacher
}) {
  const sp = useSearchParams();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState<number>(suggestedMinutes || scheduledDuration);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (sp.get("end") === "1") setOpen(true);
  }, [sp]);

  if (!open) return null;

  const close = () => {
    setOpen(false);
    // Strip the ?end=1 out so a reload doesn't reopen the modal.
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
        body:    JSON.stringify({ actualDurationMinutes: value }),
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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-md rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl">
        <header className="px-6 py-5 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-50">
            ¿Cuánto duró realmente la clase?
          </h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Esta duración se usa para calcular tu salario del mes.
          </p>
        </header>
        <div className="p-6 space-y-4">
          <label className="block">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Minutos reales</span>
            <input
              type="number"
              min={1}
              max={240}
              value={value}
              onChange={(e) => setValue(Number(e.target.value))}
              className="input-text mt-1 text-2xl font-bold tracking-tight text-center"
            />
          </label>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Sugerido: <strong>{suggestedMinutes} min</strong> · Agendado: {scheduledDuration} min
          </p>
          {error && <p className="text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>}
        </div>
        <footer className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-3">
          <button type="button" className="btn-secondary" onClick={close} disabled={pending}>
            Cerrar
          </button>
          <button type="button" className="btn-primary" onClick={submit} disabled={pending}>
            {pending ? "Guardando…" : "Confirmar"}
          </button>
        </footer>
      </div>
    </div>
  );
}
