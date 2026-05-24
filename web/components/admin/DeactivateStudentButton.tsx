"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  studentId:        string;
  studentName:      string;
  isInactive:       boolean;
  futureClassesCount: number;
};

/**
 * Botón "Dar de baja" / "Reactivar" para un estudiante.
 *
 * Baja: confirma cuántas clases futuras se cancelan/se ajustan, pide
 * razón opcional, llama al endpoint y refresca la página.
 * Reactivar: vuelve a poner active=true + status=active (NO recrea
 * clases que ya se cancelaron).
 */
export function DeactivateStudentButton({
  studentId, studentName, isInactive, futureClassesCount,
}: Props) {
  const router = useRouter();
  const [open,    setOpen]    = useState(false);
  const [busy,    setBusy]    = useState(false);
  const [reason,  setReason]  = useState("");
  const [err,     setErr]     = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/students/${studentId}/deactivate`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ reactivate: isInactive, reason: reason || undefined }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.message || d.error || `HTTP ${res.status}`);
      }
      setOpen(false);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error desconocido");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          isInactive
            ? "text-xs font-medium rounded-full border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-500/10 hover:bg-emerald-100 dark:hover:bg-emerald-500/20 px-3 py-1 text-emerald-700 dark:text-emerald-300"
            : "text-xs font-medium rounded-full border border-red-300 dark:border-red-700 bg-white dark:bg-slate-900 hover:bg-red-50 dark:hover:bg-red-500/10 px-3 py-1 text-red-600 dark:text-red-300"
        }
        title={isInactive ? "Reactivar acceso del estudiante" : "Dar de baja al estudiante (bloquea acceso)"}
      >
        {isInactive ? "↻ Reactivar" : "⛔ Dar de baja"}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={() => !busy && setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-5 space-y-3"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-50">
              {isInactive ? "Reactivar estudiante" : "Dar de baja al estudiante"}
            </h3>

            {isInactive ? (
              <p className="text-sm text-slate-600 dark:text-slate-300">
                Vas a reactivar a <strong>{studentName}</strong>. Volverá a poder iniciar
                sesión y aparecerá como activo. Las clases que se cancelaron al darlo
                de baja <strong>no se recrean</strong> — agéndalas a mano si hace falta.
              </p>
            ) : (
              <>
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  Vas a dar de baja a <strong>{studentName}</strong>. Esto:
                </p>
                <ul className="text-sm text-slate-600 dark:text-slate-300 list-disc pl-5 space-y-1">
                  <li>Bloquea su acceso a la plataforma (no podrá iniciar sesión).</li>
                  <li>Marca su suscripción como <em>cancelada</em>.</li>
                  {futureClassesCount > 0 ? (
                    <li>
                      Procesa <strong>{futureClassesCount}</strong> clase
                      {futureClassesCount === 1 ? "" : "s"} futura
                      {futureClassesCount === 1 ? "" : "s"}: las 1:1 se cancelan,
                      en las grupales lo sacamos del roster y la clase sigue para
                      el resto del grupo.
                    </li>
                  ) : (
                    <li>No tiene clases futuras agendadas.</li>
                  )}
                  <li>Notifica por WhatsApp al/los profesor(es) afectado(s).</li>
                </ul>
              </>
            )}

            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
              Razón (opcional, queda en notas internas)
              <textarea
                value={reason}
                onChange={e => setReason(e.target.value)}
                rows={2}
                maxLength={500}
                placeholder={isInactive ? "Motivo de la reactivación" : "Ej: no paga, ha terminado el curso, abandona…"}
                className="mt-1 input-text w-full resize-none"
              />
            </label>

            {err && (
              <p className="text-xs text-red-600 dark:text-red-400">{err}</p>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={busy}
                className="text-xs font-medium rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 px-3 py-1 text-slate-600 dark:text-slate-300 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={busy}
                className={
                  isInactive
                    ? "text-xs font-semibold rounded-full bg-emerald-500 hover:bg-emerald-600 text-white px-3 py-1 disabled:opacity-50"
                    : "text-xs font-semibold rounded-full bg-red-500 hover:bg-red-600 text-white px-3 py-1 disabled:opacity-50"
                }
              >
                {busy ? "Procesando…" : isInactive ? "Reactivar" : "Confirmar baja"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
