"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type Submission = {
  id:               string;
  student_id:       string;
  student_name:     string | null;
  student_email:    string;
  content:          string | null;
  status:           "submitted" | "reviewed" | "needs_revision";
  teacher_feedback: string | null;
  grade:            "A" | "B" | "C" | "D" | "F" | null;
  submitted_at:     string;
  reviewed_at:      string | null;
};

type Assignment = {
  id:           string;
  title:        string;
  description:  string | null;
  due_date:     string | null;
  submissions:  Submission[];
};

type Props = {
  classId:    string;
  assignments: Assignment[];
};

/**
 * Teacher-side homework section on the class detail page. Shows existing
 * assignments, lets teacher review submissions inline and create a new one.
 */
export function HomeworkSection({ classId, assignments }: Props) {
  const [creating, setCreating] = useState(false);
  return (
    <section className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
          Tareas ({assignments.length})
        </h2>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="text-xs font-medium rounded-full border border-brand-200 dark:border-brand-500/30 bg-brand-50 dark:bg-brand-500/10 px-3 py-1 text-brand-700 dark:text-brand-300 hover:bg-brand-100 dark:hover:bg-brand-500/20"
        >
          + Asignar tarea
        </button>
      </div>

      {assignments.length === 0 && !creating && (
        <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
          Aún no has asignado tareas para esta clase.
        </p>
      )}

      <div className="mt-4 space-y-4">
        {creating && (
          <CreateAssignment classId={classId} onDone={() => setCreating(false)} />
        )}
        {assignments.map(a => <AssignmentCard key={a.id} assignment={a} />)}
      </div>
    </section>
  );
}

function CreateAssignment({ classId, onDone }: { classId: string; onDone: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [title,       setTitle]       = useState("");
  const [description, setDescription] = useState("");
  const [dueDate,     setDueDate]     = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    if (!title.trim()) { setError("Ponle un título."); return; }
    setError(null);
    startTransition(async () => {
      const res = await fetch("/api/homework", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classId,
          title:       title.trim(),
          description: description.trim() || null,
          dueDate:     dueDate ? new Date(dueDate).toISOString() : null,
          attachments: [],
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.message ?? "Error al crear.");
        return;
      }
      onDone();
      router.refresh();
    });
  };

  return (
    <article className="rounded-2xl border border-brand-200 dark:border-brand-500/40 bg-brand-50/40 dark:bg-brand-500/5 p-4 space-y-3">
      <h3 className="text-sm font-bold text-slate-900 dark:text-slate-50">Nueva tarea</h3>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Título"
        className="input-text"
        maxLength={200}
      />
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Descripción / instrucciones (opcional)"
        rows={3}
        className="input-text"
      />
      <label className="block text-sm">
        <span className="text-slate-700 dark:text-slate-200">Fecha límite (opcional)</span>
        <input
          type="datetime-local"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          className="input-text mt-1"
        />
      </label>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex items-center gap-2">
        <button type="button" className="btn-primary text-sm" onClick={submit} disabled={pending}>
          {pending ? "Guardando…" : "Asignar"}
        </button>
        <button type="button" className="btn-secondary text-sm" onClick={onDone} disabled={pending}>
          Cancelar
        </button>
      </div>
    </article>
  );
}

function AssignmentCard({ assignment }: { assignment: Assignment }) {
  return (
    <article className="rounded-2xl border border-slate-200 dark:border-slate-800 p-4">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-50">{assignment.title}</h3>
          {assignment.due_date && (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Fecha límite: {new Date(assignment.due_date).toLocaleString("es-ES")}
            </p>
          )}
        </div>
        <span className="text-xs text-slate-500 dark:text-slate-400">
          {assignment.submissions.length} envío{assignment.submissions.length === 1 ? "" : "s"}
        </span>
      </header>
      {assignment.description && (
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300 whitespace-pre-wrap">{assignment.description}</p>
      )}
      <ul className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
        {assignment.submissions.map(s => (
          <SubmissionRow key={s.id} assignmentId={assignment.id} submission={s} />
        ))}
        {assignment.submissions.length === 0 && (
          <li className="py-2 text-xs text-slate-500 dark:text-slate-400">
            Aún nadie ha enviado la tarea.
          </li>
        )}
      </ul>
    </article>
  );
}

function SubmissionRow({ assignmentId, submission }: { assignmentId: string; submission: Submission }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [feedback, setFeedback] = useState(submission.teacher_feedback ?? "");
  const [grade,    setGrade]    = useState<Submission["grade"]>(submission.grade ?? "B");
  const [pending, startTransition] = useTransition();

  const save = (newStatus: "reviewed" | "needs_revision") => {
    startTransition(async () => {
      const res = await fetch(`/api/homework/${assignmentId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          submissionId:    submission.id,
          status:          newStatus,
          teacherFeedback: feedback.trim() || null,
          grade:           newStatus === "reviewed" ? grade : null,
        }),
      });
      if (!res.ok) { alert("No se pudo guardar."); return; }
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <li className="py-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
            {submission.student_name ?? submission.student_email}
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400">
            Enviada {new Date(submission.submitted_at).toLocaleString("es-ES")}
            {submission.status === "reviewed" && submission.grade && <> · Nota: <strong>{submission.grade}</strong></>}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          className={`text-xs font-medium rounded-full border px-3 py-1 transition-colors
            ${submission.status === "reviewed"
              ? "border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
              : submission.status === "needs_revision"
                ? "border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300"
                : "border-brand-200 dark:border-brand-500/30 bg-brand-50 dark:bg-brand-500/10 text-brand-700 dark:text-brand-300"}`}
        >
          {submission.status === "reviewed" ? "Revisada" : submission.status === "needs_revision" ? "Pedida revisión" : "Revisar"}
        </button>
      </div>
      {open && (
        <div className="mt-3 rounded-xl bg-slate-50 dark:bg-slate-950/40 p-3 space-y-3">
          {submission.content && (
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Respuesta del estudiante</p>
              <p className="mt-1 text-sm text-slate-700 dark:text-slate-200 whitespace-pre-wrap">{submission.content}</p>
            </div>
          )}
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="Feedback para el estudiante (opcional)"
            rows={3}
            className="input-text"
          />
          <div className="flex items-center gap-2 flex-wrap">
            <label className="text-sm">
              <span className="text-slate-700 dark:text-slate-200 mr-2">Nota:</span>
              <select
                value={grade ?? "B"}
                onChange={(e) => setGrade(e.target.value as NonNullable<Submission["grade"]>)}
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-sm"
              >
                {(["A", "B", "C", "D", "F"] as const).map(g => <option key={g}>{g}</option>)}
              </select>
            </label>
            <div className="ml-auto flex gap-2">
              <button
                type="button"
                className="btn-secondary text-xs"
                onClick={() => save("needs_revision")}
                disabled={pending}
              >
                Pedir rehacer
              </button>
              <button
                type="button"
                className="btn-primary text-xs"
                onClick={() => save("reviewed")}
                disabled={pending}
              >
                {pending ? "Guardando…" : "Aprobar y enviar feedback"}
              </button>
            </div>
          </div>
        </div>
      )}
    </li>
  );
}
