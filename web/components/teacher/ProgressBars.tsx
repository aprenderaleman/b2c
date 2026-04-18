"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { skillLabelEs } from "@/lib/teacher-notes";

type Skill = "speaking" | "writing" | "reading" | "listening" | "grammar" | "vocabulary";

type Score = {
  skill:       Skill;
  level_score: number;
  updated_at:  string;
};

/**
 * 6 skill bars (Hablar / Escribir / Leer / Escuchar / Gramática / Vocabulario).
 * `editable=true` shows a slider per skill + Save; read-only otherwise
 * (students see their own progress read-only).
 */
export function ProgressBars({ studentId, scores, editable }: {
  studentId: string;
  scores:    Score[];
  editable:  boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [local, setLocal] = useState<Record<Skill, number>>(() =>
    Object.fromEntries(scores.map(s => [s.skill, s.level_score])) as Record<Skill, number>
  );
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const set = (skill: Skill, v: number) => {
    setLocal(prev => ({ ...prev, [skill]: v }));
  };

  const saveOne = async (skill: Skill) => {
    setError(null);
    const v = local[skill];
    const res = await fetch("/api/teacher/progress", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ studentId, skill, score: v }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body?.message ?? `Error en ${skillLabelEs(skill)}.`);
      return false;
    }
    return true;
  };

  const saveAll = () => {
    startTransition(async () => {
      for (const sk of Object.keys(local) as Skill[]) {
        const ok = await saveOne(sk);
        if (!ok) return;
      }
      setLastSaved(new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }));
      router.refresh();
    });
  };

  return (
    <div className="space-y-3">
      <ul className="space-y-3">
        {scores.map(s => {
          const v = local[s.skill] ?? s.level_score;
          return (
            <li key={s.skill} className="space-y-1">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="font-medium text-slate-900 dark:text-slate-100">
                  {skillLabelEs(s.skill)}
                </span>
                <span className="font-mono text-slate-700 dark:text-slate-300">{v}%</span>
              </div>
              {editable ? (
                <input
                  type="range"
                  min={0} max={100} step={5}
                  value={v}
                  onChange={(e) => set(s.skill, Number(e.target.value))}
                  className="w-full accent-brand-500"
                />
              ) : (
                <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                  <div
                    className={`h-full ${
                      v >= 80 ? "bg-emerald-500" : v >= 50 ? "bg-brand-500" : "bg-amber-500"
                    }`}
                    style={{ width: `${Math.max(3, v)}%` }}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {editable && (
        <div className="flex items-center gap-3">
          <button type="button" className="btn-primary text-sm" onClick={saveAll} disabled={pending}>
            {pending ? "Guardando…" : "Guardar progreso"}
          </button>
          {lastSaved && <span className="text-xs text-emerald-700 dark:text-emerald-300">Guardado · {lastSaved}</span>}
          {error && <span className="text-xs text-red-600 dark:text-red-400">{error}</span>}
        </div>
      )}
    </div>
  );
}
