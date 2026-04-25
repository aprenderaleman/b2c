"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Hard-delete button for a trial class. Shown on each TrialClassCard
 * for admin (any class) and teacher (their own classes only — auth
 * enforcement is server-side).
 *
 * Two-click confirmation (button → confirm dialog) so a misclick
 * doesn't wipe a real booking. Uses fetch + router.refresh() so the
 * list re-renders without a hard navigation.
 */
export function DeleteTrialClassButton({
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
      `¿Eliminar permanentemente esta clase de prueba?\n\n` +
      `${niceDate} (Berlín)\n\n` +
      `El lead conserva su historial pero la clase desaparece. ` +
      `Si era la única clase agendada del lead, lo devolvemos a "en conversación".`
    )) {
      return;
    }

    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/trial-classes/${classId}/delete`, {
          method: "POST",
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
          throw new Error(data.message || data.error || `HTTP ${res.status}`);
        }
        // Reload the server component so the deleted card disappears.
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
                   border border-red-200 dark:border-red-500/30
                   bg-red-50 dark:bg-red-500/10
                   text-red-700 dark:text-red-300
                   hover:bg-red-100 dark:hover:bg-red-500/20
                   px-3.5 py-2 text-xs font-semibold transition-colors
                   disabled:opacity-50 disabled:cursor-not-allowed"
        aria-label="Eliminar clase de prueba"
      >
        {pending ? "Eliminando…" : "🗑️ Eliminar"}
      </button>
      {error && (
        <span className="text-[11px] text-red-600 dark:text-red-400" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
