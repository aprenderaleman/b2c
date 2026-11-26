"use client";

/**
 * Línea discreta del Bono de Acción Rápida en la ficha del estudiante que ve
 * el profe (Gelfis 2026-11-26). Sustituye al banner grande ocultado el
 * 2026-10-24: los profes no tenían dónde ver la clase de conversación extra
 * ni cómo marcarla, y dependía de que avisaran al admin.
 *
 * Pendiente → muestra el botón "Marcar como dada" (suma 1 clase al total del
 * plan del alumno; solo el admin puede deshacerlo). Dada → solo informa.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

export function BonoConversacionLine({ studentId, usedAt }: { studentId: string; usedAt: string | null }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (usedAt) {
    return (
      <p className="text-xs text-slate-500 dark:text-slate-400">
        🎁 Bono: clase de conversación extra · dada el{" "}
        {new Date(usedAt).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Berlin" })}
      </p>
    );
  }

  const mark = async () => {
    if (saving) return;
    if (!confirm("¿Ya diste la clase de conversación del bono?\n\nAl marcarla se suma 1 clase al total del plan del estudiante. Solo el admin puede deshacerlo.")) return;
    setSaving(true); setError(null);
    try {
      const res = await fetch(`/api/teacher/students/${studentId}/bono-conversacion`, { method: "POST", headers: { accept: "application/json" } });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.message ?? j.error ?? `HTTP ${res.status}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600 dark:text-slate-300">
      <span>
        🎁 Bono: 1 clase de conversación extra · <strong className="font-semibold text-amber-700 dark:text-amber-300">pendiente</strong>
        <span className="text-slate-500 dark:text-slate-400"> — agéndala como una clase normal</span>
      </span>
      <button
        type="button"
        onClick={mark}
        disabled={saving}
        className="rounded-full border border-slate-300 dark:border-slate-600 px-2.5 py-0.5 font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
      >
        {saving ? "Guardando…" : "Marcar como dada"}
      </button>
      {error && <span className="text-red-600 dark:text-red-400" role="alert">{error}</span>}
    </div>
  );
}
