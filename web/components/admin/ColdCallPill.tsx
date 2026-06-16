"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Toggle minimalista de "llamada fría" — solo un icono clickeable.
 * Pensado para vivir DENTRO de una fila de tabla compacta donde
 * ColdCallToggle (card de 80px) no cabe.
 *
 * Estado:
 *   - ⏰ ámbar = pendiente. Click → marca hecha.
 *   - ✓ verde = hecha. Click → desmarca.
 *
 * Optimista: cambia el icono al instante, hace POST en background.
 * Si falla, vuelve al estado anterior y muestra el error como title.
 */
export function ColdCallPill({
  leadId,
  coldCallDoneAt,
}: {
  leadId:         string;
  coldCallDoneAt: string | null;
}) {
  const router = useRouter();
  const [optimisticDone, setOptimisticDone] = useState<boolean | null>(null);
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  // Estado mostrado: optimista si lo hay, sino el real del prop.
  const isDone = optimisticDone ?? !!coldCallDoneAt;

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (pending) return;
    const next = !isDone;
    setOptimisticDone(next);
    setErr(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/admin/leads/${leadId}/cold-call`, {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ done: next }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({} as { error?: string }));
          throw new Error(data.error || `HTTP ${res.status}`);
        }
        router.refresh();
        // El optimismo se mantiene hasta que el server confirma vía
        // nuevo render (próximo fetch del lead). No reseteamos aquí
        // para que no parpadee.
      } catch (e) {
        setOptimisticDone(!next);  // rollback
        setErr(e instanceof Error ? e.message : "Error");
      }
    });
  };

  const label = err
    ? `❌ ${err}`
    : pending
      ? "guardando…"
      : isDone
        ? "Llamada hecha. Click para desmarcar."
        : "Llamada pendiente. Click para marcar hecha.";

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      title={label}
      aria-label={label}
      className={`text-[14px] leading-none transition active:scale-90 disabled:opacity-50 ${
        isDone ? "text-emerald-400 hover:text-emerald-300" : "text-amber-400 hover:text-amber-300"
      }`}
    >
      {isDone ? "✓" : "⏰"}
    </button>
  );
}
