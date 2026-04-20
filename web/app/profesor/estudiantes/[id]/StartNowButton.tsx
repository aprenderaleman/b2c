"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * "Iniciar clase ahora" — on-demand class kickoff.
 *
 * Creates a live class with status='live' server-side, attaches the
 * student as participant, notifies them in-app, and redirects the
 * teacher straight into /aula/{id}. Teacher ends the class whenever
 * they want through the normal end-class flow inside the aula, which
 * computes the real duration + billed_hours from started_at/ended_at.
 *
 * Only rendered for role=teacher (or admin previewing a teacher).
 */
export function StartNowButton({ studentId, studentName }: {
  studentId:   string;
  studentName: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const go = () => start(async () => {
    setError(null);
    if (!confirm(`¿Iniciar clase en vivo ahora con ${studentName}? Se le avisará al instante.`)) return;
    try {
      const res = await fetch("/api/teacher/classes/start-now", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ student_id: studentId }),
      });
      const data = await res.json();
      if (!res.ok || !data?.classId) {
        setError(data?.message ?? data?.error ?? "No se pudo iniciar la clase.");
        return;
      }
      // Straight into the aula — class is already status='live'.
      // Parallel live classes are allowed; no gating here.
      router.push(`/aula/${data.classId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red.");
    }
  });

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={go}
        disabled={pending}
        className="w-full inline-flex items-center justify-center gap-2
                   rounded-2xl bg-brand-500 hover:bg-brand-600
                   text-white text-sm font-semibold
                   px-4 py-3 shadow-sm transition-colors
                   disabled:opacity-60 disabled:cursor-wait"
      >
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
        </span>
        {pending ? "Iniciando…" : "Iniciar clase ahora"}
      </button>
      {error && (
        <p className="text-xs text-red-600 dark:text-red-400" role="alert">{error}</p>
      )}
      <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">
        Crea una clase individual al instante, el/la alumno/a recibe aviso y cuando termines la cierras desde el aula.
      </p>
    </div>
  );
}
