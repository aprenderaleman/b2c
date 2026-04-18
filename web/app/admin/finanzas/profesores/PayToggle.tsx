"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

/**
 * Flip a teacher_earnings row between paid ↔ unpaid. On paid=true we
 * ask for a quick reference string (bank transaction id or memo).
 */
export function PayToggle({ earningsId, paid }: { earningsId: string; paid: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const toggle = async () => {
    let reference: string | null = null;
    if (!paid) {
      reference = prompt("Referencia de pago (opcional):") ?? "";
    } else {
      if (!confirm("¿Marcar como NO pagado de nuevo?")) return;
    }

    startTransition(async () => {
      const res = await fetch(`/api/admin/finanzas/earnings/${earningsId}/pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paid: !paid, paymentReference: reference || null }),
      });
      if (!res.ok) {
        alert("No se pudo actualizar.");
        return;
      }
      router.refresh();
    });
  };

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      className={`text-xs font-medium rounded-full border px-3 py-1 transition-colors
        ${paid
          ? "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
          : "border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-500/20"}`}
    >
      {paid ? "Deshacer pago" : "Marcar pagado"}
    </button>
  );
}
