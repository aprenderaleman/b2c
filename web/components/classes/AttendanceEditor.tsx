"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type Participant = {
  student_id:    string;
  student_name:  string | null;
  student_email: string;
  attended:      boolean | null;
};

/**
 * Inline editor for class attendance. Shown on the class detail page
 * for teacher + admin on completed / live classes. Each participant
 * has three buttons: "—" (reset), "Asistió" (true), "No asistió" (false).
 * Saves on change, optimistic.
 */
export function AttendanceEditor({
  classId, participants,
}: {
  classId:       string;
  participants:  Participant[];
}) {
  const router = useRouter();
  const [state,  setState]  = useState<Record<string, boolean | null>>(() =>
    Object.fromEntries(participants.map(p => [p.student_id, p.attended])),
  );
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const setOne = (studentId: string, attended: boolean | null) => {
    setState(s => ({ ...s, [studentId]: attended }));
  };

  const save = () => {
    setError(null);
    // Only send entries that have a concrete boolean (skip nulls).
    const payload = Object.entries(state)
      .filter(([, v]) => v === true || v === false)
      .map(([student_id, attended]) => ({ student_id, attended: attended as boolean }));
    if (payload.length === 0) {
      setError("Marca al menos un estudiante.");
      return;
    }
    startTransition(async () => {
      const res = await fetch(`/api/classes/${classId}/attendance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participants: payload }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.message ?? "Error al guardar.");
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="space-y-3">
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {participants.map(p => {
          const v = state[p.student_id];
          return (
            <li key={p.student_id} className="py-2.5 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
                  {p.student_name ?? p.student_email}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                  {p.student_email}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Pill
                  active={v === null || v === undefined}
                  onClick={() => setOne(p.student_id, null)}
                  tone="neutral"
                  label="—"
                />
                <Pill
                  active={v === true}
                  onClick={() => setOne(p.student_id, true)}
                  tone="pos"
                  label="Asistió"
                />
                <Pill
                  active={v === false}
                  onClick={() => setOne(p.student_id, false)}
                  tone="neg"
                  label="No asistió"
                />
              </div>
            </li>
          );
        })}
      </ul>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <button
        type="button"
        className="btn-primary text-sm"
        onClick={save}
        disabled={pending}
      >
        {pending ? "Guardando…" : "Guardar asistencia"}
      </button>
    </div>
  );
}

function Pill({ active, onClick, label, tone }: {
  active: boolean; onClick: () => void; label: string;
  tone: "pos" | "neg" | "neutral";
}) {
  const base = "text-xs font-medium rounded-full border px-3 py-1 transition-colors";
  const activeCls =
    tone === "pos"    ? "border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" :
    tone === "neg"    ? "border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400" :
                        "border-slate-300 dark:border-slate-600 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200";
  const idleCls = "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800";
  return (
    <button type="button" onClick={onClick} className={`${base} ${active ? activeCls : idleCls}`}>
      {label}
    </button>
  );
}
