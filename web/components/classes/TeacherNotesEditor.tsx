"use client";

import { useState, useCallback } from "react";

export function TeacherNotesEditor({
  classId,
  initialNotes,
  initialShared,
}: {
  classId: string;
  initialNotes: string | null;
  initialShared: boolean;
}) {
  const [notes, setNotes] = useState(initialNotes ?? "");
  const [shared, setShared] = useState(initialShared);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const save = useCallback(async () => {
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch(`/api/teacher/classes/${classId}/notes`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teacher_notes: notes || null,
          shared_with_student: shared,
        }),
      });
      if (res.ok) setSaved(true);
    } finally {
      setSaving(false);
    }
  }, [classId, notes, shared]);

  return (
    <section className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
        Notas de clase
      </h2>
      <textarea
        className="mt-3 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
        rows={3}
        maxLength={2000}
        placeholder="Apuntes sobre esta clase (opcional)..."
        value={notes}
        onChange={e => { setNotes(e.target.value); setSaved(false); }}
      />
      <div className="mt-3 flex items-center justify-between gap-3 flex-wrap">
        <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400 cursor-pointer">
          <input
            type="checkbox"
            checked={shared}
            onChange={e => { setShared(e.target.checked); setSaved(false); }}
            className="rounded border-slate-300 dark:border-slate-600 text-brand-600 focus:ring-brand-500"
          />
          Visible para el alumno
        </label>
        <div className="flex items-center gap-2">
          {saved && (
            <span className="text-xs text-emerald-600 dark:text-emerald-400">Guardado</span>
          )}
          <button
            onClick={save}
            disabled={saving}
            className="rounded-full bg-brand-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {saving ? "Guardando..." : "Guardar notas"}
          </button>
        </div>
      </div>
    </section>
  );
}
