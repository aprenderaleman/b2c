"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Cancelar una clase individual (hasta 24 h antes; el API revalida). */
export function StudentCancelButton({ classId }: { classId: string }) {
  const router = useRouter();
  const [busy,  setBusy]  = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cancel = async () => {
    if (!window.confirm("¿Cancelar esta clase? La clase vuelve a tu saldo.")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/student/schedule/${classId}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data?.message ?? "No se pudo cancelar. Inténtalo de nuevo."); return; }
      router.refresh();
    } catch {
      setError("Sin conexión. Inténtalo de nuevo.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        disabled={busy}
        onClick={cancel}
        className="mt-2 block w-full text-center rounded-2xl border border-rose-200 dark:border-rose-500/40 px-4 py-2 text-sm font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10 disabled:opacity-60"
      >
        {busy ? "Cancelando…" : "Cancelar esta clase"}
      </button>
      {error && <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{error}</p>}
    </>
  );
}
