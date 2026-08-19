"use client";

import { useState } from "react";

/**
 * "👁 Ver como alumno" — abre SCHULE con el profe logueado como el
 * alumno en solo lectura (banner púrpura + auditoría los pone SCHULE).
 * Outline púrpura: acción sensible, no primaria.
 */
export function ViewAsStudentButton({ studentId }: { studentId: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onClick = async (e: React.MouseEvent) => {
    // El botón vive junto a un <Link> de fila — no navegar la fila.
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/teacher/students/${studentId}/impersonate`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.redirectUrl) {
        setErr(data.message ?? "No se pudo abrir. Intenta de nuevo.");
        return;
      }
      // Pestaña nueva — el profe conserva su sesión de B2C aquí.
      window.open(data.redirectUrl, "_blank", "noopener");
    } catch {
      setErr("Error de conexión.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-violet-300 dark:border-violet-500/40
                   px-2.5 py-1.5 text-xs font-semibold text-violet-700 dark:text-violet-300
                   hover:bg-violet-50 dark:hover:bg-violet-500/10 disabled:opacity-50 transition"
        title="Abrir SCHULE como este alumno (solo lectura)"
      >
        👁 {busy ? "Abriendo…" : "Ver como alumno"}
      </button>
      {err && <span className="text-[10px] text-red-500 max-w-[160px] truncate" title={err}>{err}</span>}
    </span>
  );
}
