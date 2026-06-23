"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function ScheduleClassModal({
  studentId,
  studentName,
  onClose,
}: {
  studentId: string;
  studentName: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError]     = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const [dateTime, setDateTime]       = useState("");
  const [duration, setDuration]       = useState(45);
  const [recurrence, setRecurrence]   = useState<"none" | "weekly" | "biweekly">("none");
  const [endDate, setEndDate]         = useState("");
  const [title, setTitle]             = useState(`Clase de aleman - ${studentName}`);

  const canSubmit = dateTime.length > 0 && title.trim().length > 0;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    startTransition(async () => {
      try {
        const body: Record<string, unknown> = {
          type: "individual",
          studentIds: [studentId],
          scheduledAt: new Date(dateTime).toISOString(),
          durationMinutes: duration,
          recurrencePattern: recurrence,
          title: title.trim(),
        };
        if (recurrence !== "none" && endDate) {
          body.recurrenceEndDate = endDate;
        }
        const res = await fetch("/api/teacher/classes", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error || `HTTP ${res.status}`);
        }
        setSuccess(true);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error al crear clase.");
      }
    });
  };

  if (success) {
    return (
      <Overlay onClose={onClose}>
        <div className="text-center py-8">
          <div className="text-4xl mb-3">📅</div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            Clase{recurrence !== "none" ? "s" : ""} agendada{recurrence !== "none" ? "s" : ""}
          </h2>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            Las clases aparecen en tu calendario y en el perfil del estudiante.
          </p>
          <button
            onClick={onClose}
            className="mt-4 text-sm font-semibold rounded-full border border-emerald-400 bg-emerald-500 text-white px-5 py-2 hover:bg-emerald-600"
          >
            Cerrar
          </button>
        </div>
      </Overlay>
    );
  }

  return (
    <Overlay onClose={onClose}>
      <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
        Agendar clases · {studentName}
      </h2>

      <form onSubmit={submit} className="mt-5 space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            Titulo
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-400"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              Fecha y hora <span className="text-rose-500">*</span>
            </label>
            <input
              type="datetime-local"
              value={dateTime}
              onChange={(e) => setDateTime(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-400"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              Duracion (min)
            </label>
            <select
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-400"
            >
              {[30, 45, 60, 90].map(m => (
                <option key={m} value={m}>{m} min</option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              Recurrencia
            </label>
            <select
              value={recurrence}
              onChange={(e) => setRecurrence(e.target.value as "none" | "weekly" | "biweekly")}
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-400"
            >
              <option value="none">Sin recurrencia</option>
              <option value="weekly">Semanal</option>
              <option value="biweekly">Quincenal</option>
            </select>
          </div>

          {recurrence !== "none" && (
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                Hasta
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-400"
              />
            </div>
          )}
        </div>

        {error && (
          <div className="rounded-lg bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 px-3 py-2 text-sm text-rose-700 dark:text-rose-300">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="text-sm rounded-full border border-slate-300 dark:border-slate-600 px-4 py-1.5 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={!canSubmit || pending}
            className="text-sm font-semibold rounded-full border border-sky-400 bg-sky-500 text-white px-4 py-1.5 hover:bg-sky-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {pending ? "Creando..." : "Agendar clase"}
          </button>
        </div>
      </form>
    </Overlay>
  );
}

function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 p-6 shadow-2xl border border-slate-200 dark:border-slate-700"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
