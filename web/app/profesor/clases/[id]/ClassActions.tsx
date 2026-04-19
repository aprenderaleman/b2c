"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Actions visible only while a class is in status='scheduled':
 *   - Reprogramar: date + time + duration + title + topic (opens a modal)
 *   - Cancelar: confirm → DELETE /api/teacher/classes/{id} (soft cancel)
 *
 * Both hit the teacher-scoped endpoint, which re-validates ownership.
 * Students are notified automatically via WhatsApp + in-app.
 */
export function ClassActions({
  classId,
  scheduledAt,
  durationMinutes,
  title,
  topic,
}: {
  classId:         string;
  scheduledAt:     string;
  durationMinutes: number;
  title:           string;
  topic:           string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editOpen, setEditOpen] = useState(false);

  const cancel = () => {
    if (!confirm("¿Cancelar esta clase? Se avisará al alumno/s por WhatsApp y quedará marcada como cancelada.")) return;
    start(async () => {
      const res  = await fetch(`/api/teacher/classes/${classId}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) { alert(data?.message ?? data?.error ?? "No se pudo cancelar."); return; }
      router.refresh();
    });
  };

  return (
    <>
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => setEditOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-brand-400 text-slate-700 dark:text-slate-200 hover:text-brand-600 dark:hover:text-brand-400 px-3 py-1.5 text-xs font-medium transition-colors"
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="m18.5 2.5 3 3L12 15l-4 1 1-4 9.5-9.5Z" />
          </svg>
          Reprogramar
        </button>
        <button
          type="button"
          onClick={cancel}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-full border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 hover:bg-red-100 dark:hover:bg-red-500/20 text-red-700 dark:text-red-300 px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50"
        >
          {pending ? "Cancelando…" : "Cancelar clase"}
        </button>
      </div>

      {editOpen && (
        <RescheduleModal
          classId={classId}
          scheduledAt={scheduledAt}
          durationMinutes={durationMinutes}
          title={title}
          topic={topic}
          onClose={() => setEditOpen(false)}
          onSaved={() => { setEditOpen(false); router.refresh(); }}
        />
      )}
    </>
  );
}

function RescheduleModal({
  classId, scheduledAt, durationMinutes, title, topic, onClose, onSaved,
}: {
  classId:         string;
  scheduledAt:     string;
  durationMinutes: number;
  title:           string;
  topic:           string | null;
  onClose:         () => void;
  onSaved:         () => void;
}) {
  // Split ISO UTC → Berlin local date + time for the form inputs.
  const localDate = berlinDate(scheduledAt);
  const localTime = berlinTime(scheduledAt);

  const [dateStr, setDateStr] = useState(localDate);
  const [timeStr, setTimeStr] = useState(localTime);
  const [dur, setDur]         = useState(durationMinutes);
  const [t, setT]             = useState(title);
  const [tp, setTp]           = useState(topic ?? "");
  const [error, setError]     = useState<string | null>(null);
  const [pending, start]      = useTransition();

  const save = () => {
    setError(null);
    if (!dateStr || !timeStr) { setError("Indica fecha y hora."); return; }
    // Berlin local → UTC ISO. Browser is Europe/Berlin for Gelfis + profes.
    const iso = new Date(`${dateStr}T${timeStr}:00`).toISOString();
    start(async () => {
      const res  = await fetch(`/api/teacher/classes/${classId}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          scheduledAt:     iso,
          durationMinutes: dur,
          title:           t.trim(),
          topic:           tp.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data?.message ?? data?.error ?? "No se pudo guardar."); return; }
      onSaved();
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog" aria-modal
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-lg rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl">
        <header className="px-6 py-5 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-50">Reprogramar clase</h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Se avisará al alumno/s por WhatsApp con la nueva fecha.
          </p>
        </header>

        <div className="p-6 space-y-4">
          <div className="grid sm:grid-cols-3 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-slate-700 dark:text-slate-200">Fecha</span>
              <input type="date" value={dateStr} onChange={(e) => setDateStr(e.target.value)}
                className="mt-1 input-text w-full" />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-700 dark:text-slate-200">Hora (Berlín)</span>
              <input type="time" step={300} value={timeStr} onChange={(e) => setTimeStr(e.target.value)}
                className="mt-1 input-text w-full" />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-700 dark:text-slate-200">Duración</span>
              <select value={dur} onChange={(e) => setDur(Number(e.target.value))}
                className="mt-1 input-text w-full">
                {[30, 45, 60, 75, 90, 105, 120].map(m => (
                  <option key={m} value={m}>{m} min</option>
                ))}
              </select>
            </label>
          </div>

          <label className="block">
            <span className="text-xs font-medium text-slate-700 dark:text-slate-200">Título</span>
            <input value={t} onChange={(e) => setT(e.target.value)}
              className="mt-1 input-text w-full" maxLength={200} />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-700 dark:text-slate-200">Tema (opcional)</span>
            <input value={tp} onChange={(e) => setTp(e.target.value)}
              className="mt-1 input-text w-full" maxLength={500} />
          </label>

          {error && <p className="text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>}
        </div>

        <footer className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-3">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={pending}>Cancelar</button>
          <button type="button" className="btn-primary"   onClick={save}    disabled={pending}>
            {pending ? "Guardando…" : "Guardar cambios"}
          </button>
        </footer>
      </div>
    </div>
  );
}

function berlinDate(iso: string): string {
  // Render the UTC timestamp in Europe/Berlin as YYYY-MM-DD.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(iso));
  const y = parts.find(p => p.type === "year")?.value;
  const m = parts.find(p => p.type === "month")?.value;
  const d = parts.find(p => p.type === "day")?.value;
  return `${y}-${m}-${d}`;
}
function berlinTime(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date(iso));
  const h = parts.find(p => p.type === "hour")?.value;
  const m = parts.find(p => p.type === "minute")?.value;
  return `${h}:${m}`;
}
