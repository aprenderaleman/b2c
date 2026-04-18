"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type Note = {
  id:           string;
  note_type:    "class_summary" | "progress" | "behavior" | "general";
  content:      string;
  created_at:   string;
  teacher_name: string | null;
  class_title:  string | null;
};

const TYPE_LABELS: Record<Note["note_type"], string> = {
  class_summary: "Resumen de clase",
  progress:      "Progreso",
  behavior:      "Comportamiento",
  general:       "General",
};

const TYPE_COLORS: Record<Note["note_type"], string> = {
  class_summary: "bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-500/30",
  progress:      "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30",
  behavior:      "bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-500/30",
  general:       "bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700",
};

export function NotesTimeline({
  studentId, classId, notes,
}: {
  studentId: string;
  classId:   string | null;
  notes:     Note[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [type,    setType]    = useState<Note["note_type"]>("class_summary");
  const [content, setContent] = useState("");
  const [error,   setError]   = useState<string | null>(null);

  const submit = () => {
    if (content.trim().length < 3) { setError("Escribe una nota."); return; }
    setError(null);
    startTransition(async () => {
      const res = await fetch("/api/teacher/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId, classId, noteType: type, content: content.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.message ?? "Error al guardar.");
        return;
      }
      setContent("");
      router.refresh();
    });
  };

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 p-3 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          {(["class_summary", "progress", "behavior", "general"] as Note["note_type"][]).map(t => (
            <button
              key={t}
              type="button"
              onClick={() => setType(t)}
              className={`text-xs font-medium rounded-full border px-3 py-1 transition-colors ${
                type === t
                  ? TYPE_COLORS[t]
                  : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800"
              }`}
            >
              {TYPE_LABELS[t]}
            </button>
          ))}
        </div>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Escribe una nota privada sobre el estudiante…"
          rows={3}
          className="input-text"
        />
        {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
        <button type="button" className="btn-primary text-sm" onClick={submit} disabled={pending}>
          {pending ? "Guardando…" : "Añadir nota"}
        </button>
      </div>

      {notes.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">Aún no hay notas sobre este estudiante.</p>
      ) : (
        <ul className="space-y-2">
          {notes.map(n => (
            <li key={n.id} className="rounded-2xl border border-slate-200 dark:border-slate-800 p-3">
              <div className="flex items-center gap-2 text-xs flex-wrap">
                <span className={`rounded-full border px-2 py-0.5 font-medium ${TYPE_COLORS[n.note_type]}`}>
                  {TYPE_LABELS[n.note_type]}
                </span>
                {n.class_title && (
                  <span className="text-slate-500 dark:text-slate-400">· {n.class_title}</span>
                )}
                {n.teacher_name && (
                  <span className="text-slate-400 dark:text-slate-500">· {n.teacher_name}</span>
                )}
                <span className="ml-auto text-slate-400">
                  {new Date(n.created_at).toLocaleString("es-ES")}
                </span>
              </div>
              <p className="mt-2 text-sm text-slate-700 dark:text-slate-200 whitespace-pre-wrap">{n.content}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
