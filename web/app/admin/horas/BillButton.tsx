"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

export function BillButton({
  classId,
  computedBh,
}: {
  classId: string;
  computedBh: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const bill = () => {
    if (!confirm(`¿Facturar esta clase con ${computedBh} unidad(es)?`)) return;

    startTransition(async () => {
      const res = await fetch("/api/admin/horas/bill-class", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ classId, billedHours: computedBh }),
      });
      if (!res.ok) {
        alert("Error al facturar.");
        return;
      }
      router.refresh();
    });
  };

  return (
    <button
      type="button"
      onClick={bill}
      disabled={pending || computedBh === 0}
      className="text-xs font-medium rounded-full border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-500/20 px-3 py-1 transition-colors disabled:opacity-50"
    >
      {pending ? "…" : `Facturar (${computedBh}u)`}
    </button>
  );
}

export function BillAllButton({ classIds }: { classIds: Array<{ id: string; bh: number }> }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const billAll = () => {
    if (classIds.length === 0) return;
    if (
      !confirm(
        `¿Facturar ${classIds.length} clase(s) automáticamente?`
      )
    )
      return;

    startTransition(async () => {
      let ok = 0;
      for (const c of classIds) {
        const res = await fetch("/api/admin/horas/bill-class", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ classId: c.id, billedHours: c.bh }),
        });
        if (res.ok) ok++;
      }
      alert(`${ok}/${classIds.length} facturadas.`);
      router.refresh();
    });
  };

  return (
    <button
      type="button"
      onClick={billAll}
      disabled={pending || classIds.length === 0}
      className="text-xs font-medium rounded-full border border-blue-200 dark:border-blue-500/30 bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-500/20 px-3 py-1 transition-colors disabled:opacity-50"
    >
      {pending
        ? "Facturando…"
        : `Facturar todas con evidencia (${classIds.length})`}
    </button>
  );
}
