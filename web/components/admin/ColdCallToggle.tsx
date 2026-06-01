"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Toggle de "llamada fría" para un lead concreto.
 * - Si `coldCallDoneAt === null` muestra estado "Pendiente" + botón verde "Marcar hecha".
 * - Si tiene timestamp muestra "✅ hecha hace X días" + botón gris "Desmarcar".
 *
 * Tras la operación llama a `router.refresh()` para que el server
 * component pinte el nuevo estado sin recarga completa.
 */
export function ColdCallToggle({
  leadId,
  coldCallDoneAt,
}: {
  leadId:         string;
  coldCallDoneAt: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const isDone = !!coldCallDoneAt;

  const handleToggle = () => {
    setErr(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/admin/leads/${leadId}/cold-call`, {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ done: !isDone }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({} as { error?: string }));
          throw new Error(data.error || `HTTP ${res.status}`);
        }
        router.refresh();
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Error desconocido");
      }
    });
  };

  // Formato "hace X" amistoso. Lo calculamos en el cliente porque el
  // server component pasa el timestamp absoluto y no queremos depender
  // de Intl.RelativeTimeFormat en hidratación inicial.
  const relativeLabel = isDone ? formatRelative(coldCallDoneAt!) : "";

  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-800 p-3
                    flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Llamada fría
        </div>
        <div className="mt-1 text-sm">
          {isDone ? (
            <span className="text-emerald-700 dark:text-emerald-300 font-medium">
              ✅ Hecha {relativeLabel}
            </span>
          ) : (
            <span className="text-amber-700 dark:text-amber-300 font-medium">
              ⏰ Pendiente
            </span>
          )}
        </div>
        {err && (
          <div className="mt-1 text-xs text-red-600 dark:text-red-400">
            {err}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={handleToggle}
        disabled={pending}
        className={[
          "text-xs font-semibold rounded-lg px-3 py-1.5 transition",
          isDone
            ? "bg-slate-200 hover:bg-slate-300 text-slate-800 dark:bg-slate-700 dark:hover:bg-slate-600 dark:text-slate-100"
            : "bg-emerald-600 hover:bg-emerald-700 text-white",
          pending ? "opacity-60 cursor-not-allowed" : "",
        ].join(" ")}
      >
        {pending
          ? "…"
          : isDone
            ? "Desmarcar"
            : "✓ Marcar hecha"}
      </button>
    </div>
  );
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const diffMs = Date.now() - then;
  const min  = Math.floor(diffMs / 60_000);
  if (min < 1)  return "hace un instante";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24)   return `hace ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 7)    return `hace ${d} ${d === 1 ? "día" : "días"}`;
  const w = Math.floor(d / 7);
  if (w < 5)    return `hace ${w} ${w === 1 ? "semana" : "semanas"}`;
  const months = Math.floor(d / 30);
  return `hace ${months} ${months === 1 ? "mes" : "meses"}`;
}
