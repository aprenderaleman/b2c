"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

/**
 * HARD-delete a class. Goes through /api/admin/classes/{id}/permanent
 * which cascades the row + every dependent record (participants,
 * notifications, recordings, homework, chat threads, finance invoices).
 *
 * Server-side guard: refuses if status='completed'. The button itself
 * stays visible so the admin can see the option, but a refusal alert
 * fires if they try.
 *
 * For recurring series, offers the same two-step menu as the soft
 * cancel: "this only" or "this + all later instances".
 *
 * After a successful delete the admin lands back on /admin/clases via
 * router.push (the current detail page would be 404 otherwise).
 */
export function DeleteClassPermanentButton({
  classId, isSeries,
}: { classId: string; isSeries: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  const doDelete = (whole: boolean) => {
    if (!confirm(whole
      ? "⚠️  Eliminación PERMANENTE\n\nVas a borrar esta clase y TODAS las clases futuras de la serie. Junto con asistencia, notificaciones, grabaciones y deberes asociados.\n\nEsta acción NO se puede deshacer. ¿Continuar?"
      : "⚠️  Eliminación PERMANENTE\n\nVas a borrar esta clase y todo lo que cuelga de ella (asistencia, notificaciones, grabaciones, deberes).\n\nEsta acción NO se puede deshacer. ¿Continuar?")) return;

    startTransition(async () => {
      const url = `/api/admin/classes/${classId}/permanent${whole ? "?whole=1" : ""}`;
      const res = await fetch(url, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data?.message ?? data?.error ?? "No se pudo eliminar.");
        return;
      }
      setOpen(false);
      // The current detail page just got nuked — go back to the list.
      router.push("/admin/clases");
      router.refresh();
    });
  };

  if (!isSeries) {
    return (
      <button
        type="button"
        disabled={pending}
        onClick={() => doDelete(false)}
        className="text-xs font-medium rounded-full border border-red-300 dark:border-red-600 bg-red-100 dark:bg-red-500/20 px-3 py-1 text-red-800 dark:text-red-200 hover:bg-red-200 dark:hover:bg-red-500/30 disabled:opacity-50"
        title="Borrar la clase y todo lo asociado, irreversible"
      >
        Eliminar permanentemente
      </button>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        disabled={pending}
        className="text-xs font-medium rounded-full border border-red-300 dark:border-red-600 bg-red-100 dark:bg-red-500/20 px-3 py-1 text-red-800 dark:text-red-200 hover:bg-red-200 dark:hover:bg-red-500/30 disabled:opacity-50"
      >
        Eliminar ▾
      </button>
      {open && (
        <div
          className="absolute right-0 mt-1 w-64 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg z-20 overflow-hidden"
          onMouseLeave={() => setOpen(false)}
        >
          <button
            type="button"
            className="block w-full text-left px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
            onClick={() => doDelete(false)}
            disabled={pending}
          >
            Sólo esta clase (permanente)
          </button>
          <button
            type="button"
            className="block w-full text-left px-3 py-2 text-sm text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-500/10"
            onClick={() => doDelete(true)}
            disabled={pending}
          >
            Toda la serie (permanente)
          </button>
        </div>
      )}
    </div>
  );
}
