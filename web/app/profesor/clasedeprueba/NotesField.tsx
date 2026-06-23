"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { saveTeacherNotes } from "./actions";

export function NotesField({
  classId,
  initialNotes,
}: {
  classId: string;
  initialNotes: string | null;
}) {
  const [value, setValue] = useState(initialNotes ?? "");
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const save = useCallback(async (text: string) => {
    setStatus("saving");
    try {
      await saveTeacherNotes(classId, text);
      setStatus("saved");
    } catch {
      setStatus("idle");
    }
  }, [classId]);

  useEffect(() => {
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  const handleChange = (text: string) => {
    setValue(text);
    setStatus("idle");
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => save(text), 1500);
  };

  return (
    <div>
      <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">
        Notas de la clase
      </label>
      <textarea
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        rows={3}
        placeholder="Escribe tus notas durante la clase..."
        className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-400 resize-y"
      />
      <div className="mt-1 h-4 text-[11px] text-slate-400">
        {status === "saving" && "Guardando..."}
        {status === "saved" && "Guardado ✓"}
      </div>
    </div>
  );
}
