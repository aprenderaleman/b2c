"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type Assignment = {
  id:          string;
  title:       string;
  description: string | null;
  due_date:    string | null;
  class_title: string;
  submission: null | {
    id:               string;
    content:          string | null;
    status:           "submitted" | "reviewed" | "needs_revision";
    teacher_feedback: string | null;
    grade:            "A" | "B" | "C" | "D" | "F" | null;
    submitted_at:     string;
    reviewed_at:      string | null;
  };
};

export function HomeworkSubmitCard({ assignment }: { assignment: Assignment }) {
  const router = useRouter();
  const [content, setContent] = useState(assignment.submission?.content ?? "");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const canEdit = !assignment.submission || assignment.submission.status === "needs_revision";

  const submit = () => {
    if (!content.trim()) { setError("Escribe tu respuesta."); return; }
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/homework/${assignment.id}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.message ?? "Error al enviar.");
        return;
      }
      router.refresh();
    });
  };

  return (
    <article className="rounded-2xl border border-slate-200 dark:border-slate-800 p-4 bg-slate-50/40 dark:bg-slate-950/40">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-50">
            {assignment.title}
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Clase: {assignment.class_title}
            {assignment.due_date && <> · Fecha límite: <strong>{new Date(assignment.due_date).toLocaleString("es-ES")}</strong></>}
          </p>
        </div>
        {assignment.submission && <StatusPill submission={assignment.submission} />}
      </header>

      {assignment.description && (
        <p className="mt-3 text-sm text-slate-700 dark:text-slate-200 whitespace-pre-wrap">
          {assignment.description}
        </p>
      )}

      {assignment.submission?.status === "reviewed" && assignment.submission.teacher_feedback && (
        <div className="mt-3 rounded-xl border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10 p-3 text-sm text-emerald-800 dark:text-emerald-200">
          <strong>Feedback del profesor:</strong>
          <p className="mt-1 whitespace-pre-wrap">{assignment.submission.teacher_feedback}</p>
          {assignment.submission.grade && (
            <p className="mt-2 text-xs">Nota: <strong>{assignment.submission.grade}</strong></p>
          )}
        </div>
      )}

      {assignment.submission?.status === "needs_revision" && (
        <div className="mt-3 rounded-xl border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">
          <strong>El profesor te pide rehacer la tarea.</strong>
          {assignment.submission.teacher_feedback && (
            <p className="mt-1 whitespace-pre-wrap">{assignment.submission.teacher_feedback}</p>
          )}
        </div>
      )}

      {canEdit ? (
        <div className="mt-4 space-y-3">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={4}
            placeholder="Escribe tu respuesta aquí…"
            className="input-text"
          />
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <button
            type="button"
            className="btn-primary text-sm"
            onClick={submit}
            disabled={pending}
          >
            {pending
              ? "Enviando…"
              : assignment.submission ? "Reenviar" : "Enviar tarea"}
          </button>
        </div>
      ) : assignment.submission?.content && (
        <div className="mt-3">
          <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Tu respuesta</p>
          <p className="mt-1 text-sm text-slate-700 dark:text-slate-200 whitespace-pre-wrap">
            {assignment.submission.content}
          </p>
        </div>
      )}
    </article>
  );
}

function StatusPill({ submission }: { submission: NonNullable<Assignment["submission"]> }) {
  const label =
    submission.status === "reviewed"       ? "Revisada" :
    submission.status === "needs_revision" ? "Necesita revisión" :
                                             "Enviada, en revisión";
  const cls =
    submission.status === "reviewed"       ? "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30" :
    submission.status === "needs_revision" ? "bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-500/30" :
                                             "bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-500/30";
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${cls}`}>
      {label}
    </span>
  );
}
