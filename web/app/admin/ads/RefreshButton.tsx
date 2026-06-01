"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Botón "Actualizar" para /admin/ads — invalida el cache del Server
 * Component y re-fetcha los datos en vivo. Muestra estado de carga
 * mientras Next revalida (~200-800ms).
 */
export function RefreshButton({ at }: { at: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        router.refresh();
        // El router.refresh es síncrono pero el revalidate del server
        // dura un momento; mantenemos el spinner ~600ms para feedback.
        setTimeout(() => setBusy(false), 700);
      }}
      title={`Última carga: ${at}`}
      className="inline-flex items-center gap-2 h-9 px-3 rounded-md text-sm
                 border border-white/10 bg-white/5 text-white hover:bg-white/10
                 disabled:opacity-60 transition"
    >
      <svg
        viewBox="0 0 24 24"
        className={`h-4 w-4 ${busy ? "animate-spin" : ""}`}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M21 12a9 9 0 1 1-3-6.7" />
        <polyline points="21 4 21 10 15 10" />
      </svg>
      {busy ? "Actualizando…" : "Actualizar"}
    </button>
  );
}
