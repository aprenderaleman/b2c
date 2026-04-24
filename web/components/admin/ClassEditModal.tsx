"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Admin edit modal for a single class. Supports editing either THIS
 * class only or this + every later still-scheduled instance of the
 * series (if the class has a parent_class_id). Past/completed classes
 * are never touched.
 *
 * For scheduled_at on a series edit, the API applies a DELTA so weekly
 * spacing is preserved — moving one Tuesday class to Wednesday shifts
 * every subsequent Tuesday to Wednesday automatically.
 */
export function ClassEditModal({
  open, onClose, classInfo,
}: {
  open:    boolean;
  onClose: () => void;
  classInfo: {
    id:                string;
    title:             string;
    topic:             string | null;
    scheduledAt:       string;     // ISO
    durationMinutes:   number;
    hasSeries:         boolean;    // true if part of a recurrence chain
  };
}) {
  const router = useRouter();

  // Pre-fill with current values
  const [title,    setTitle]    = useState(classInfo.title);
  const [topic,    setTopic]    = useState(classInfo.topic ?? "");
  const [dateStr,  setDateStr]  = useState(isoToDate(classInfo.scheduledAt));
  const [timeStr,  setTimeStr]  = useState(isoToTime(classInfo.scheduledAt));
  const [duration, setDuration] = useState<number>(classInfo.durationMinutes);
  const [scope,    setScope]    = useState<"this" | "series">("this");
  const [error,    setError]    = useState<string | null>(null);
  const [pending,  start]       = useTransition();

  useEffect(() => {
    if (!open) return;
    setTitle(classInfo.title);
    setTopic(classInfo.topic ?? "");
    setDateStr(isoToDate(classInfo.scheduledAt));
    setTimeStr(isoToTime(classInfo.scheduledAt));
    setDuration(classInfo.durationMinutes);
    setScope("this");
    setError(null);
  }, [open, classInfo]);

  if (!open) return null;

  const save = () => {
    setError(null);
    if (!title.trim()) { setError("El título es obligatorio."); return; }
    if (!dateStr || !timeStr) { setError("Indica fecha y hora."); return; }

    // Build ISO datetime — the admin's browser is presumably Europe/Berlin.
    // `new Date("YYYY-MM-DDTHH:mm")` interprets local time, which is what
    // we want for admin-friendly editing.
    const scheduledAt = new Date(`${dateStr}T${timeStr}:00`).toISOString();

    const body: Record<string, unknown> = {
      scope,
      title:            title.trim(),
      topic:            topic.trim() || null,
      duration_minutes: duration,
      scheduled_at:     scheduledAt,
    };

    start(async () => {
      const res = await fetch(`/api/admin/classes/${classInfo.id}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.message ?? data?.error ?? "No se pudo guardar.");
        return;
      }
      router.refresh();
      onClose();
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog" aria-modal
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-lg rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl max-h-[92vh] overflow-y-auto">
        <header className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-50">Editar clase</h2>
          <button
            type="button" onClick={onClose}
            className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-100 text-2xl leading-none"
            aria-label="Cerrar"
          >×</button>
        </header>

        <div className="p-6 space-y-5 text-sm">
          <label className="block">
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 uppercase tracking-wide">Título</span>
            <input value={title} onChange={e => setTitle(e.target.value)} className="input-text w-full mt-1.5" />
          </label>

          <label className="block">
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 uppercase tracking-wide">Tema</span>
            <input value={topic} onChange={e => setTopic(e.target.value)} className="input-text w-full mt-1.5" placeholder="Opcional" />
          </label>

          <div className="grid sm:grid-cols-3 gap-4">
            <label className="block">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 uppercase tracking-wide">Fecha</span>
              <input type="date" value={dateStr} onChange={e => setDateStr(e.target.value)} className="input-text w-full mt-1.5" />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 uppercase tracking-wide">Hora (Berlín)</span>
              <input type="time" step={300} value={timeStr} onChange={e => setTimeStr(e.target.value)} className="input-text w-full mt-1.5" />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 uppercase tracking-wide">Duración</span>
              <select value={duration} onChange={e => setDuration(Number(e.target.value))} className="input-text w-full mt-1.5">
                {[30, 45, 60, 75, 90, 105, 120, 150, 180].map(m => (
                  <option key={m} value={m}>{m} min</option>
                ))}
              </select>
            </label>
          </div>

          {classInfo.hasSeries && (
            <fieldset className="rounded-2xl border border-slate-200 dark:border-slate-700 p-4">
              <legend className="px-2 text-xs font-semibold text-slate-700 dark:text-slate-200 uppercase tracking-wide">
                Alcance del cambio
              </legend>
              <div className="space-y-2 mt-2">
                <ScopeRadio
                  checked={scope === "this"}
                  onChange={() => setScope("this")}
                  title="Solo esta clase"
                  subtitle="El resto de la serie se queda como está."
                />
                <ScopeRadio
                  checked={scope === "series"}
                  onChange={() => setScope("series")}
                  title="Esta clase y las siguientes"
                  subtitle="Afecta a cada clase futura de la serie. Las pasadas/completadas no se tocan."
                />
              </div>
              {scope === "series" && (
                <p className="mt-3 text-[11px] text-slate-500 dark:text-slate-400">
                  Si cambias la fecha/hora, el desfase se aplica en cascada (ej. mover 1 día adelanta todas las siguientes 1 día).
                </p>
              )}
            </fieldset>
          )}

          {error && <p className="text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>}
        </div>

        <footer className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-3 sticky bottom-0 bg-white dark:bg-slate-900">
          <button type="button" onClick={onClose} className="btn-secondary" disabled={pending}>Cancelar</button>
          <button type="button" onClick={save} className="btn-primary" disabled={pending}>
            {pending ? "Guardando…" : "Guardar cambios"}
          </button>
        </footer>
      </div>
    </div>
  );
}

function ScopeRadio({ checked, onChange, title, subtitle }: {
  checked: boolean; onChange: () => void; title: string; subtitle: string;
}) {
  return (
    <label className={`flex items-start gap-3 cursor-pointer rounded-xl p-3 border transition-colors
                       ${checked
                         ? "border-brand-500 bg-brand-50 dark:bg-brand-500/10"
                         : "border-slate-200 dark:border-slate-700 hover:border-brand-400"}`}>
      <input type="radio" checked={checked} onChange={onChange} className="mt-0.5 h-4 w-4 text-brand-500" />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-slate-900 dark:text-slate-100">{title}</span>
        <span className="block text-xs text-slate-500 dark:text-slate-400">{subtitle}</span>
      </span>
    </label>
  );
}

function isoToDate(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function isoToTime(iso: string): string {
  const d = new Date(iso);
  const h = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${mi}`;
}
