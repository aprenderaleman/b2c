"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

/**
 * Soft-cancel a class. If it's part of a recurring series, offers two
 * choices: cancel just this instance, or cancel every remaining instance.
 */
export function CancelClassButton({
  classId, isSeries,
}: { classId: string; isSeries: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  const doCancel = (whole: boolean) => {
    if (!confirm(whole
      ? "Se cancelarán TODAS las clases futuras de esta serie. ¿Continuar?"
      : "¿Seguro que quieres cancelar esta clase?")) return;

    startTransition(async () => {
      const url = `/api/admin/classes/${classId}${whole ? "?whole=1" : ""}`;
      const res = await fetch(url, { method: "DELETE" });
      if (!res.ok) {
        alert("No se pudo cancelar. Inténtalo de nuevo.");
        return;
      }
      setOpen(false);
      router.refresh();
    });
  };

  if (!isSeries) {
    return (
      <button
        type="button"
        disabled={pending}
        onClick={() => doCancel(false)}
        className="text-xs font-medium rounded-full border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 px-3 py-1 text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-500/20 disabled:opacity-50"
      >
        Cancelar clase
      </button>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        disabled={pending}
        className="text-xs font-medium rounded-full border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 px-3 py-1 text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-500/20 disabled:opacity-50"
      >
        Cancelar ▾
      </button>
      {open && (
        <div
          className="absolute right-0 mt-1 w-56 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg z-20 overflow-hidden"
          onMouseLeave={() => setOpen(false)}
        >
          <button
            type="button"
            className="block w-full text-left px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
            onClick={() => doCancel(false)}
            disabled={pending}
          >
            Sólo esta clase
          </button>
          <button
            type="button"
            className="block w-full text-left px-3 py-2 text-sm text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-500/10"
            onClick={() => doCancel(true)}
            disabled={pending}
          >
            Toda la serie futura
          </button>
        </div>
      )}
    </div>
  );
}
