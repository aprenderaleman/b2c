"use client";

import { useEffect, useState } from "react";

/**
 * Bloqueos puntuales de disponibilidad (migración 137, fase 2 del plan
 * de agendado — Gelfis 2026-10-06): "el lunes 4/5 de 17:00 a 18:00 no
 * estoy". Se restan del motor de huecos (trials + agendado de alumnos).
 *
 * Se renderiza debajo del AvailabilityEditor en /profesor/disponibilidad
 * y /admin/disponibilidad. `targetTeacherId` se pasa SIEMPRE (los profes
 * lo ignoran — el API resuelve por sesión; los admins lo necesitan).
 */

type ExceptionRow = {
  id:         string;
  date:       string;   // YYYY-MM-DD
  start_time: string;   // HH:MM:SS
  end_time:   string;
  reason:     string | null;
};

const TIME_OPTIONS: string[] = [];
for (let h = 0; h < 24; h++) {
  for (const m of ["00", "15", "30", "45"]) {
    TIME_OPTIONS.push(`${String(h).padStart(2, "0")}:${m}`);
  }
}

function fmtDateEs(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("es-ES", {
    weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Berlin",
  });
}

export function ExceptionsEditor({ targetTeacherId }: { targetTeacherId: string }) {
  const api = `/api/teacher/availability/exceptions?teacherId=${encodeURIComponent(targetTeacherId)}`;
  const [rows,    setRows]    = useState<ExceptionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [saving,  setSaving]  = useState(false);

  const [date,  setDate]  = useState("");
  const [start, setStart] = useState("17:00");
  const [end,   setEnd]   = useState("18:00");
  const [reason, setReason] = useState("");

  const load = async () => {
    try {
      const res = await fetch(api);
      if (!res.ok) return;
      const data = await res.json();
      setRows(data.exceptions ?? []);
    } catch { /* offline */ }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const add = async () => {
    setError(null);
    if (!date) { setError("Elige una fecha."); return; }
    if (end <= start) { setError("La hora fin debe ser mayor que la de inicio."); return; }
    setSaving(true);
    try {
      const res = await fetch(api, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, start_time: start, end_time: end, reason: reason || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data?.message ?? data?.error ?? "Error al guardar."); return; }
      setReason("");
      await load();
    } finally { setSaving(false); }
  };

  const remove = async (id: string) => {
    await fetch(`${api}&id=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => null);
    await load();
  };

  const todayBerlin = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(new Date());

  return (
    <section className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
      <h3 className="text-sm font-bold text-slate-900 dark:text-slate-50">Bloqueos puntuales</h3>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 max-w-2xl">
        Para días concretos en los que NO estás disponible dentro de tu horario
        habitual (médico, viaje…). Ese hueco deja de ofrecerse para clases de
        prueba y agendados. Horas de Berlín.
      </p>

      <div className="mt-3 flex items-end gap-2 flex-wrap">
        <label className="text-xs text-slate-600 dark:text-slate-300">
          <span className="block mb-1">Fecha</span>
          <input
            type="date"
            value={date}
            min={todayBerlin}
            onChange={e => setDate(e.target.value)}
            className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-2 text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
          />
        </label>
        <label className="text-xs text-slate-600 dark:text-slate-300">
          <span className="block mb-1">Desde</span>
          <TimeSelect value={start} onChange={setStart} />
        </label>
        <label className="text-xs text-slate-600 dark:text-slate-300">
          <span className="block mb-1">Hasta</span>
          <TimeSelect value={end} onChange={setEnd} />
        </label>
        <label className="text-xs text-slate-600 dark:text-slate-300 flex-1 min-w-[140px]">
          <span className="block mb-1">Motivo (opcional)</span>
          <input
            type="text"
            value={reason}
            maxLength={200}
            onChange={e => setReason(e.target.value)}
            placeholder="médico, viaje…"
            className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-2 text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
          />
        </label>
        <button
          type="button"
          onClick={() => void add()}
          disabled={saving}
          className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {saving ? "…" : "+ Bloquear"}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400" role="alert">{error}</p>}

      <div className="mt-4">
        {loading && <p className="text-xs text-slate-500">Cargando…</p>}
        {!loading && rows.length === 0 && (
          <p className="text-xs text-slate-500 dark:text-slate-400">Sin bloqueos futuros.</p>
        )}
        {rows.length > 0 && (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.map(r => (
              <li key={r.id} className="py-2 flex items-center justify-between gap-3 flex-wrap">
                <div className="text-sm text-slate-800 dark:text-slate-200">
                  <span className="capitalize font-medium">{fmtDateEs(r.date)}</span>
                  <span className="mx-1.5 text-slate-400">·</span>
                  <span className="font-mono">{r.start_time.slice(0, 5)}–{r.end_time.slice(0, 5)}</span>
                  {r.reason && <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">({r.reason})</span>}
                </div>
                <button
                  type="button"
                  onClick={() => void remove(r.id)}
                  className="text-xs text-red-600 dark:text-red-400 hover:underline"
                >
                  Eliminar
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function TimeSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-2 text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-500/40 tabular-nums"
    >
      {TIME_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
    </select>
  );
}
