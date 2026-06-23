"use client";

import { useState, useTransition } from "react";
import { saveTeacherNotes } from "./actions";

export function NotesField({
  classId,
  initialNotes,
}: {
  classId: string;
  initialNotes: string | null;
}) {
  const [value, setValue] = useState(initialNotes ?? "");
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const dirty = value !== (initialNotes ?? "");

  const handleSave = () => {
    if (!value.trim()) return;
    setSaved(false);
    startTransition(async () => {
      try {
        await saveTeacherNotes(classId, value.trim());
        setSaved(true);
      } catch {
        alert("Error al guardar notas");
      }
    });
  };

  return (
    <div>
      <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">
        Notas de la clase
      </label>
      <textarea
        value={value}
        onChange={(e) => { setValue(e.target.value); setSaved(false); }}
        rows={3}
        placeholder="Escribe tus notas durante la clase..."
        className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-400 resize-y"
      />
      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={pending || !value.trim()}
          className="text-xs font-semibold rounded-full border border-sky-300 dark:border-sky-500/40 bg-sky-100 dark:bg-sky-500/15 px-3 py-1.5 text-sky-800 dark:text-sky-200 hover:bg-sky-200 dark:hover:bg-sky-500/25 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {pending ? "Guardando..." : "Guardar notas"}
        </button>
        {saved && !dirty && (
          <span className="text-[11px] text-emerald-600 dark:text-emerald-400">Guardado ✓</span>
        )}
      </div>
    </div>
  );
}
