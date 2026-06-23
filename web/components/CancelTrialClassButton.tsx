"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Botón "Cancelar" para una clase de prueba — alternativa NO destructiva
 * al DeleteTrialClassButton (que sigue activo solo para superadmin).
 *
 * Marca classes.status='cancelled' sin borrar registro — mantiene
 * historial completo. NO envía mensajes al lead (Gelfis 2026-06-23).
 *
 * Disponible para teacher y admin/superadmin.
 */
export function CancelTrialClassButton({
  classId,
  scheduledAtIso,
}: {
  classId:        string;
  scheduledAtIso: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const onClick = () => {
    const niceDate = new Date(scheduledAtIso).toLocaleString("es-ES", {
      timeZone: "Europe/Berlin",
      weekday:  "long",
      day:      "numeric",
      month:    "long",
      hour:     "2-digit",
      minute:   "2-digit",
    });
    if (!confirm(
      `¿Cancelar esta clase de prueba?\n\n` +
      `${niceDate} (Berlín)\n\n` +
      `La clase queda marcada como cancelada (no se elimina). ` +
      `No se envía mensaje al lead.`
    )) {
      return;
    }

    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/trial-classes/${classId}/cancel`, {
          method: "POST",
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
          throw new Error(data.message || data.error || `HTTP ${res.status}`);
        }
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "unknown");
      }
    });
  };

  return (
    <div className="flex flex-col items-stretch gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="inline-flex items-center justify-center gap-1.5 rounded-xl
                   border border-amber-200 dark:border-amber-500/30
                   bg-amber-50 dark:bg-amber-500/10
                   text-amber-700 dark:text-amber-300
                   hover:bg-amber-100 dark:hover:bg-amber-500/20
                   px-3.5 py-2 text-xs font-semibold transition-colors
                   disabled:opacity-50 disabled:cursor-not-allowed"
        aria-label="Cancelar clase de prueba"
      >
        {pending ? "Cancelando…" : "🚫 Cancelar"}
      </button>
      {error && (
        <span className="text-[11px] text-red-600 dark:text-red-400" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
