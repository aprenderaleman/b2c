"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Switch on /admin/profesores/[id] that toggles whether this teacher
 * is in the trial-class rotation pool. Server enforces the same via
 * the existing PATCH /api/admin/teachers/[id] endpoint.
 */
export function AcceptsTrialsToggle({
  teacherId,
  initialValue,
}: {
  teacherId:    string;
  initialValue: boolean;
}) {
  const router = useRouter();
  const [on, setOn]       = useState(initialValue);
  const [pending, start]  = useTransition();
  const [error, setError] = useState<string | null>(null);

  const flip = () => {
    const next = !on;
    setError(null);
    setOn(next);                       // optimistic
    start(async () => {
      try {
        const res = await fetch(`/api/admin/teachers/${teacherId}`, {
          method:  "PATCH",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ accepts_trials: next }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setOn(!next);                // rollback
          setError(data?.message ?? data?.error ?? "No se pudo guardar.");
          return;
        }
        router.refresh();
      } catch (e) {
        setOn(!next);
        setError(e instanceof Error ? e.message : "Error de red.");
      }
    });
  };

  return (
    <div className="flex items-start justify-between gap-3 rounded-2xl border border-border bg-card p-4">
      <div className="min-w-0">
        <div className="text-sm font-semibold text-foreground">
          Recibe clases de prueba
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Si está activo, este profesor entra en la rotación automática del funnel
          público. Si está apagado, los nuevos leads nunca le son asignados.
        </p>
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      </div>
      <button
        type="button"
        onClick={flip}
        disabled={pending}
        role="switch"
        aria-checked={on}
        className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors
                    ${on ? "bg-warm" : "bg-slate-300 dark:bg-slate-700"}
                    disabled:opacity-60`}
      >
        <span
          className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform
                      ${on ? "translate-x-6" : "translate-x-1"}`}
        />
      </button>
    </div>
  );
}
