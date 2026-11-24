"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Toggle "Grabaciones activas" por alumno (Bono de Acción Rápida,
 * Gelfis 2026-11-26) para /admin/estudiantes/[id]. Con el toggle ON:
 * todas sus clases se graban desde ese momento y ve la página
 * "Grabaciones" en su menú. Se activa solo al ganar el bono 48h; este
 * toggle cubre excepciones manuales (caso Doris).
 */
export function RecordingsToggle({
  studentId,
  initialEnabled,
  personLabel,
}: {
  studentId:      string;
  initialEnabled: boolean;
  personLabel:    string;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [pending, start]      = useTransition();
  const [error, setError]     = useState<string | null>(null);

  const toggle = () => {
    const next = !enabled;
    const msg = next
      ? `¿ACTIVAR las grabaciones para ${personLabel}?\n\nTodas sus clases se grabarán desde ahora y verá "Grabaciones" en su menú (beneficio del Bono de Acción Rápida).`
      : `¿DESACTIVAR las grabaciones para ${personLabel}?\n\nSus clases dejan de grabarse y la página desaparece de su menú. Las grabaciones existentes entran en la retención de 30 días.`;
    if (!confirm(msg)) return;

    setError(null);
    start(async () => {
      try {
        const res = await fetch(`/api/admin/students/${studentId}/recordings-enabled`, {
          method:  "PATCH",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ enabled: next }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data?.message ?? data?.error ?? "No se pudo guardar.");
          return;
        }
        setEnabled(next);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error de red.");
      }
    });
  };

  return (
    <div className={`rounded-2xl border p-4 ${
      enabled
        ? "border-emerald-300 dark:border-emerald-500/40 bg-emerald-50/60 dark:bg-emerald-500/10"
        : "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"
    }`}>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-50">
            🎬 Grabaciones de clases (Bono de Acción Rápida)
          </h3>
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
            {enabled
              ? <><strong className="text-emerald-700 dark:text-emerald-300">Activas.</strong> Todas sus clases se graban y las ve en su menú. Retención: plan activo + 30 días.</>
              : "Desactivadas. Sus clases no se graban y no ve la página de Grabaciones."}
          </p>
        </div>
        <button
          type="button"
          onClick={toggle}
          disabled={pending}
          className={`shrink-0 inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-60 disabled:cursor-wait
            ${enabled
              ? "bg-slate-800 hover:bg-slate-900 dark:bg-slate-700 dark:hover:bg-slate-600 text-white"
              : "bg-emerald-500 hover:bg-emerald-600 text-white"}`}
        >
          {pending ? "Guardando…" : enabled ? "Desactivar" : "Activar"}
        </button>
      </div>
      {error && (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400" role="alert">{error}</p>
      )}
    </div>
  );
}
