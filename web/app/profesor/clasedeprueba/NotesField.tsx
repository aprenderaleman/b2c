"use client";

import { useState, useTransition, useEffect, useRef, useCallback, useImperativeHandle, forwardRef } from "react";
import { saveTeacherNotes } from "./actions";

const AUTOSAVE_DELAY_MS = 1500;

export interface NotesFieldHandle {
  flush: () => Promise<void>;
}

export const NotesField = forwardRef<NotesFieldHandle, {
  classId: string;
  initialNotes: string | null;
}>(function NotesField({ classId, initialNotes }, ref) {
  const [value, setValue] = useState(initialNotes ?? "");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [pending, startTransition] = useTransition();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef(initialNotes ?? "");
  const valueRef = useRef(value);
  valueRef.current = value;

  const dirty = value.trim() !== lastSavedRef.current.trim();

  const doSave = useCallback((text: string) => {
    if (!text.trim() || text.trim() === lastSavedRef.current.trim()) return;
    setStatus("saving");
    startTransition(async () => {
      try {
        await saveTeacherNotes(classId, text.trim());
        lastSavedRef.current = text.trim();
        setStatus("saved");
      } catch {
        setStatus("error");
      }
    });
  }, [classId, startTransition]);

  const flushNow = useCallback(async () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const text = valueRef.current.trim();
    if (!text || text === lastSavedRef.current.trim()) return;
    try {
      await saveTeacherNotes(classId, text);
      lastSavedRef.current = text;
      setStatus("saved");
    } catch { /* action buttons proceed regardless */ }
  }, [classId]);

  useImperativeHandle(ref, () => ({ flush: flushNow }), [flushNow]);

  useEffect(() => {
    if (!dirty) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => doSave(value), AUTOSAVE_DELAY_MS);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [value, dirty, doSave]);

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (valueRef.current.trim() !== lastSavedRef.current.trim()) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  return (
    <div>
      <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">
        Notas de la clase
      </label>
      <textarea
        value={value}
        onChange={(e) => { setValue(e.target.value); setStatus("idle"); }}
        onBlur={() => { if (dirty) doSave(value); }}
        rows={3}
        placeholder="Escribe tus notas durante la clase..."
        className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-400 resize-y"
      />
      <div className="mt-1.5 flex items-center gap-3 min-h-[24px]">
        {(status === "saving" || pending) && (
          <span className="text-[11px] text-slate-400 dark:text-slate-500">Guardando...</span>
        )}
        {status === "saved" && !dirty && !pending && (
          <span className="text-[11px] text-emerald-600 dark:text-emerald-400">Guardado automaticamente</span>
        )}
        {status === "error" && (
          <span className="text-[11px] text-red-600 dark:text-red-400">Error al guardar — reintentando...</span>
        )}
        {dirty && status === "idle" && !pending && (
          <span className="text-[11px] text-amber-500 dark:text-amber-400">Sin guardar</span>
        )}
      </div>
    </div>
  );
});
