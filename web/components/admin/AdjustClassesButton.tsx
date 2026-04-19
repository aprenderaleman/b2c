"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * "Ajustar clases" — admin-only modal that lets you set a new
 * classes_remaining value for a student. Shows the math upfront
 * (purchased / consumed / current adjustment) so it's obvious what
 * you're changing. Requires a reason for the audit trail.
 *
 * Rendered on /admin/estudiantes/{id}.
 */
export function AdjustClassesButton({
  studentId,
  studentName,
  currentRemaining,
  purchased,
  consumed,
  currentAdjustment,
}: {
  studentId:         string;
  studentName:       string;
  currentRemaining:  number;
  purchased:         number;
  consumed:          number;
  currentAdjustment: number;
}) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<number>(currentRemaining);
  const [reason, setReason] = useState("");
  const [error, setError]   = useState<string | null>(null);
  const [pending, start]    = useTransition();
  const router = useRouter();

  const save = () => {
    setError(null);
    if (reason.trim().length < 3) { setError("Escribe un motivo (mín. 3 caracteres)."); return; }
    if (target === currentRemaining) { setError("No hay cambios."); return; }

    start(async () => {
      const res = await fetch(`/api/admin/students/${studentId}/adjust-classes`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ target_remaining: target, reason: reason.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data?.message ?? data?.error ?? "Error al guardar"); return; }
      setOpen(false);
      router.refresh();
    });
  };

  const delta = target - currentRemaining;

  return (
    <>
      <button
        type="button"
        onClick={() => { setTarget(currentRemaining); setReason(""); setError(null); setOpen(true); }}
        className="text-xs font-medium rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1 text-slate-600 dark:text-slate-300 hover:border-brand-400 hover:text-brand-600"
      >
        Ajustar clases
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog" aria-modal
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <div className="w-full max-w-md rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl">
            <header className="px-5 py-4 border-b border-slate-200 dark:border-slate-800">
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-50">
                Ajustar clases de {studentName}
              </h2>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                El número restante se recalcula automáticamente. El cambio queda registrado con motivo.
              </p>
            </header>

            <div className="p-5 space-y-4 text-sm">
              {/* Math breakdown */}
              <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-50 dark:bg-slate-800/60 p-3 text-xs">
                <KV k="Pack comprado" v={purchased} />
                <KV k="Clases dadas"  v={consumed} />
                <KV k="Ajuste actual" v={formatAdj(currentAdjustment)} />
                <KV k="Restan ahora"  v={currentRemaining} bold />
              </div>

              <label className="block">
                <span className="text-xs font-medium text-slate-700 dark:text-slate-200">
                  Nuevo número de clases restantes
                </span>
                <input
                  type="number" min={0} max={9999}
                  value={target}
                  onChange={(e) => setTarget(Math.max(0, parseInt(e.target.value || "0", 10)))}
                  className="mt-1 input-text w-full"
                />
                <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                  Cambio: <strong className={
                    delta === 0 ? "" :
                    delta > 0   ? "text-emerald-600 dark:text-emerald-400"
                                : "text-red-600 dark:text-red-400"
                  }>
                    {delta > 0 ? `+${delta}` : delta}
                  </strong> clase{Math.abs(delta) === 1 ? "" : "s"}
                </p>
              </label>

              <label className="block">
                <span className="text-xs font-medium text-slate-700 dark:text-slate-200">
                  Motivo (queda en el log de auditoría)
                </span>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  className="mt-1 input-text w-full"
                  placeholder="Ej. 2 clases de compensación por problemas técnicos del 15/04"
                  maxLength={500}
                />
              </label>

              {error && <p className="text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>}
            </div>

            <footer className="px-5 py-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-3">
              <button type="button" className="btn-secondary" onClick={() => setOpen(false)} disabled={pending}>
                Cancelar
              </button>
              <button type="button" className="btn-primary"   onClick={save}                   disabled={pending}>
                {pending ? "Guardando…" : "Guardar ajuste"}
              </button>
            </footer>
          </div>
        </div>
      )}
    </>
  );
}

function KV({ k, v, bold = false }: { k: string; v: string | number; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-500 dark:text-slate-400">{k}</span>
      <span className={`${bold ? "font-bold" : "font-semibold"} text-slate-900 dark:text-slate-50`}>{v}</span>
    </div>
  );
}

function formatAdj(n: number): string {
  if (n === 0) return "0";
  return n > 0 ? `+${n}` : `${n}`;
}
