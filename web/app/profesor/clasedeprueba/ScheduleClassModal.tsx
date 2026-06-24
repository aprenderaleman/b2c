"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Modal para agendar clases regulares de un estudiante ya convertido
 * (Gelfis 2026-06-23: flexible, multi-slot).
 *
 * Permite añadir varios horarios — útil para casos no comunes:
 *   - "Lunes 18:00 + Miércoles 20:00 + Sábado 10:00, todos semanal".
 *   - "Una clase puntual en una fecha + serie quincenal aparte".
 *   - "Slot A 30 min, Slot B 60 min" (duraciones distintas).
 *
 * Envía un único POST a /api/teacher/classes/bulk → backend crea las
 * series y manda UN email consolidado al estudiante con resumen +
 * primera clase + instrucciones.
 */

type Recurrence = "none" | "weekly" | "biweekly";

type Slot = {
  id: string;          // local key
  dateTime: string;    // datetime-local string
  duration: number;
  recurrence: Recurrence;
  endDate: string;     // YYYY-MM-DD (vacío si recurrence=none)
};

const makeSlot = (): Slot => ({
  id: Math.random().toString(36).slice(2),
  dateTime: "",
  duration: 30,
  recurrence: "weekly",
  endDate: "",
});

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
  const [success, setSuccess] = useState<{ total: number; firstAt: string } | null>(null);

  const [title, setTitle] = useState(`Clase de aleman - ${studentName}`);
  const [slots, setSlots] = useState<Slot[]>([makeSlot()]);

  const canSubmit =
    title.trim().length > 0 &&
    slots.every(s => s.dateTime.length > 0 && (s.recurrence === "none" || s.endDate.length > 0));

  const updateSlot = (id: string, patch: Partial<Slot>) =>
    setSlots(prev => prev.map(s => (s.id === id ? { ...s, ...patch } : s)));

  const addSlot = () => {
    if (slots.length >= 7) return;
    setSlots(prev => [...prev, makeSlot()]);
  };
  const removeSlot = (id: string) =>
    setSlots(prev => (prev.length > 1 ? prev.filter(s => s.id !== id) : prev));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    startTransition(async () => {
      try {
        const body = {
          type: "individual" as const,
          studentIds: [studentId],
          title: title.trim(),
          slots: slots.map(s => ({
            scheduledAt:       new Date(s.dateTime).toISOString(),
            durationMinutes:   s.duration,
            recurrencePattern: s.recurrence,
            recurrenceEndDate: s.recurrence === "none" ? null : s.endDate,
          })),
        };
        const res = await fetch("/api/teacher/classes/bulk", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.message || j.error || `HTTP ${res.status}`);
        }
        const data = await res.json() as { total_classes?: number; first_class_at?: string };
        setSuccess({
          total: data.total_classes ?? 0,
          firstAt: data.first_class_at
            ? new Date(data.first_class_at).toLocaleString("es-ES", {
                weekday: "long", day: "numeric", month: "long",
                hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin",
              })
            : "",
        });
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error al agendar.");
      }
    });
  };

  if (success) {
    return (
      <Overlay onClose={onClose}>
        <div className="text-center py-8">
          <div className="text-4xl mb-3">📅</div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            ¡{success.total} clase{success.total === 1 ? "" : "s"} agendada{success.total === 1 ? "" : "s"}!
          </h2>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            Primera clase: <strong>{success.firstAt}</strong> (Berlín).<br />
            Le hemos enviado un email al estudiante con el resumen.
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
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
        Puedes añadir varios horarios. Cada uno con su propia recurrencia.
        Al guardar, el estudiante recibe un email con el resumen y su primera clase.
      </p>

      <form onSubmit={submit} className="mt-5 space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            Título
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-400"
          />
        </div>

        <div className="space-y-3">
          {slots.map((s, idx) => (
            <div key={s.id} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 p-3 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Horario {idx + 1}
                </span>
                {slots.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeSlot(s.id)}
                    className="text-xs text-rose-600 dark:text-rose-400 hover:underline"
                  >
                    Eliminar
                  </button>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-600 dark:text-slate-400">
                    Fecha y hora <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="datetime-local"
                    value={s.dateTime}
                    onChange={(e) => updateSlot(s.id, { dateTime: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-1.5 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-400"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-600 dark:text-slate-400">
                    Duración (min)
                  </label>
                  <select
                    value={s.duration}
                    onChange={(e) => updateSlot(s.id, { duration: Number(e.target.value) })}
                    className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-1.5 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-400"
                  >
                    {[30, 45, 60, 75, 90, 120].map(m => (
                      <option key={m} value={m}>{m} min</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-600 dark:text-slate-400">
                    Recurrencia
                  </label>
                  <select
                    value={s.recurrence}
                    onChange={(e) => updateSlot(s.id, { recurrence: e.target.value as Recurrence })}
                    className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-1.5 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-400"
                  >
                    <option value="none">Una sola vez</option>
                    <option value="weekly">Cada semana</option>
                    <option value="biweekly">Cada 2 semanas</option>
                  </select>
                </div>
                {s.recurrence !== "none" && (
                  <div>
                    <label className="block text-xs text-slate-600 dark:text-slate-400">
                      Hasta <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="date"
                      value={s.endDate}
                      onChange={(e) => updateSlot(s.id, { endDate: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-1.5 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-400"
                      required
                    />
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {slots.length < 7 && (
          <button
            type="button"
            onClick={addSlot}
            className="w-full text-sm font-semibold rounded-lg border border-dashed border-sky-300 dark:border-sky-500/40 bg-sky-50 dark:bg-sky-500/10 px-3 py-2 text-sky-700 dark:text-sky-300 hover:bg-sky-100 dark:hover:bg-sky-500/20"
          >
            + Añadir otro horario
          </button>
        )}

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
            {pending ? "Agendando…" : `Agendar ${slots.length === 1 ? "clase" : `${slots.length} horarios`}`}
          </button>
        </div>
      </form>
    </Overlay>
  );
}

function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 overflow-y-auto" onClick={onClose}>
      <div
        className="w-full max-w-xl rounded-2xl bg-white dark:bg-slate-900 p-6 shadow-2xl border border-slate-200 dark:border-slate-700 my-8"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
