"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export default function RefreshButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [at, setAt] = useState<Date | null>(null);

  return (
    <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
      {at && <span>Actualizado {at.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}</span>}
      <button
        type="button"
        disabled={pending}
        onClick={() => start(() => { router.refresh(); setAt(new Date()); })}
        className="btn-secondary text-xs disabled:opacity-60"
      >
        {pending ? "Actualizando…" : "↻ Actualizar datos"}
      </button>
    </div>
  );
}
