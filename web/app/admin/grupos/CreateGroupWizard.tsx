"use client";

import { useState, useEffect, useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  generateSchedule,
  type ScheduleSpec,
  type ScheduleEntry,
  type Weekday,
  MAX_SESSIONS_PER_SCHEDULE,
} from "@/lib/schedule";

const ALL_LEVELS = ["A0","A1","A2","B1","B2","C1","C2"] as const;
type Level = typeof ALL_LEVELS[number];

const WEEKDAY_LABELS: Array<{ id: Weekday; short: string; long: string }> = [
  { id: 1, short: "L", long: "Lun" },
  { id: 2, short: "M", long: "Mar" },
  { id: 3, short: "X", long: "Mié" },
  { id: 4, short: "J", long: "Jue" },
  { id: 5, short: "V", long: "Vie" },
  { id: 6, short: "S", long: "Sáb" },
  { id: 0, short: "D", long: "Dom" },
];

type Teacher = { id: string; full_name: string | null; email: string };
type Student = {
  id: string; full_name: string | null; email: string;
  current_level: string;
};

type ScheduleMode = ScheduleSpec["mode"];

/**
 * 3-step wizard for creating a class group + its full schedule in
 * one shot. Replaces the two-step "create group then create classes"
 * flow that was confusing the admin.
 *
 * Step 1 — group info (name, levels, teacher, capacity, members, total).
 * Step 2 — schedule (5 modes; preview-driven).
 * Step 3 — confirm: list of generated classes, optional per-row delete.
 *
 * Submit hits POST /api/admin/groups/with-schedule which atomically
 * creates the group + class rows + membership/participants.
 */
export function CreateGroupWizard({
  open, onClose, teachers, students,
}: {
  open:     boolean;
  onClose:  () => void;
  teachers: Teacher[];
  students: Student[];
}) {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Step 1
  const [name, setName]             = useState("");
  const [levels, setLevels]         = useState<Level[]>([]);
  const [teacherId, setTeacherId]   = useState("");
  const [capacity, setCapacity]     = useState<number>(10);
  const [memberIds, setMemberIds]   = useState<string[]>([]);
  const [totalSessions, setTotal]   = useState<number | "">("");

  // Step 2 — schedule
  const [mode, setMode]               = useState<ScheduleMode>("weekly_days");
  const [weekdays, setWeekdays]       = useState<Weekday[]>([]);
  const [time, setTime]               = useState("19:00");
  const [duration, setDuration]       = useState<number>(60);
  const [firstDate, setFirstDate]     = useState(todayIsoDate());
  const [recurringSessions, setRSes]  = useState<number>(20);
  const [dayOfMonth, setDayOfMonth]   = useState<number>(1);
  const [singleDate, setSingleDate]   = useState(todayIsoDate());
  const [singleTime, setSingleTime]   = useState("19:00");
  const [singleDuration, setSingleDur] = useState<number>(60);
  const [customEntries, setCustomE]   = useState<Array<{ date: string; time: string; durationMin: number }>>([
    { date: todayIsoDate(), time: "19:00", durationMin: 60 },
  ]);

  // Step 3 — preview entries (mutable so user can delete one)
  const [previewEntries, setPreviewEntries] = useState<ScheduleEntry[]>([]);

  const [error, setError]   = useState<string | null>(null);
  const [pending, startTr]  = useTransition();

  useEffect(() => {
    if (!open) return;
    setStep(1);
    setName(""); setLevels([]); setTeacherId(teachers[0]?.id ?? "");
    setCapacity(10); setMemberIds([]); setTotal("");
    setMode("weekly_days"); setWeekdays([]); setTime("19:00"); setDuration(60);
    setFirstDate(todayIsoDate()); setRSes(20); setDayOfMonth(1);
    setSingleDate(todayIsoDate()); setSingleTime("19:00"); setSingleDur(60);
    setCustomE([{ date: todayIsoDate(), time: "19:00", durationMin: 60 }]);
    setPreviewEntries([]);
    setError(null);
  }, [open, teachers]);

  // Build the spec from current state.
  const spec: ScheduleSpec | null = useMemo(() => {
    switch (mode) {
      case "weekly_days":
      case "biweekly_days":
        if (weekdays.length === 0 || !firstDate) return null;
        return {
          mode,
          weekdays,
          time,
          durationMin:    duration,
          totalSessions:  recurringSessions,
          firstDate,
        };
      case "monthly_day":
        if (!firstDate) return null;
        return {
          mode,
          dayOfMonth,
          time,
          durationMin:    duration,
          totalSessions:  recurringSessions,
          firstDate,
        };
      case "single":
        return { mode: "single", date: singleDate, time: singleTime, durationMin: singleDuration };
      case "custom_dates":
        if (customEntries.length === 0) return null;
        return { mode: "custom_dates", entries: customEntries };
    }
  }, [
    mode, weekdays, time, duration, firstDate, recurringSessions,
    dayOfMonth, singleDate, singleTime, singleDuration, customEntries,
  ]);

  if (!open) return null;

  const goNext = () => {
    setError(null);
    if (step === 1) {
      if (!name.trim() || name.trim().length < 2) { setError("El nombre del grupo es obligatorio (≥ 2 caracteres)."); return; }
      if (!teacherId) { setError("Selecciona un profesor."); return; }
      setStep(2);
      return;
    }
    if (step === 2) {
      if (!spec) { setError("Completa los parámetros de la agenda."); return; }
      const generated = generateSchedule(spec);
      if (generated.length === 0) { setError("La configuración no generó ninguna clase. Revisa los parámetros."); return; }
      setPreviewEntries(generated);
      setStep(3);
      return;
    }
  };

  const goBack = () => {
    setError(null);
    if (step > 1) setStep((step - 1) as typeof step);
  };

  const submit = () => {
    setError(null);
    if (previewEntries.length === 0) { setError("Añade al menos una clase."); return; }
    startTr(async () => {
      const res = await fetch("/api/admin/groups/with-schedule", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          group: {
            name:           name.trim(),
            class_type:     "group",
            levels,
            teacher_id:     teacherId,
            capacity,
            notes:          null,
            total_sessions: totalSessions === "" ? null : Number(totalSessions),
          },
          members: memberIds,
          classes: previewEntries.map(e => ({
            scheduled_at_iso: e.scheduledAtIso,
            duration_min:     e.durationMin,
          })),
          title: name.trim(),
          topic: null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.message ?? data?.error ?? "No se pudo crear el grupo.");
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
      <div className="w-full max-w-3xl rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl max-h-[92vh] overflow-y-auto">
        <header className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 sticky top-0 bg-white dark:bg-slate-900 z-10">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-slate-50">Crear grupo + agenda</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Paso {step} de 3 · {step === 1 ? "Datos del grupo" : step === 2 ? "Cuándo serán las clases" : "Confirmar"}
              </p>
            </div>
            <button type="button" onClick={onClose} aria-label="Cerrar"
              className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-100 text-2xl leading-none">×</button>
          </div>
          {/* Step indicator */}
          <div className="mt-3 grid grid-cols-3 gap-1">
            {[1,2,3].map(s => (
              <div key={s} className={`h-1 rounded-full ${s <= step ? "bg-brand-500" : "bg-slate-200 dark:bg-slate-700"}`} />
            ))}
          </div>
        </header>

        <div className="p-6 space-y-5 text-sm">
          {step === 1 && (
            <Step1
              name={name} setName={setName}
              levels={levels} setLevels={setLevels}
              teachers={teachers} teacherId={teacherId} setTeacherId={setTeacherId}
              capacity={capacity} setCapacity={setCapacity}
              students={students} memberIds={memberIds} setMemberIds={setMemberIds}
              totalSessions={totalSessions} setTotal={setTotal}
            />
          )}

          {step === 2 && (
            <Step2
              mode={mode} setMode={setMode}
              weekdays={weekdays} setWeekdays={setWeekdays}
              time={time} setTime={setTime}
              duration={duration} setDuration={setDuration}
              firstDate={firstDate} setFirstDate={setFirstDate}
              sessions={recurringSessions} setSessions={setRSes}
              dayOfMonth={dayOfMonth} setDayOfMonth={setDayOfMonth}
              singleDate={singleDate} setSingleDate={setSingleDate}
              singleTime={singleTime} setSingleTime={setSingleTime}
              singleDuration={singleDuration} setSingleDur={setSingleDur}
              customEntries={customEntries} setCustomE={setCustomE}
              specPreview={spec ? generateSchedule(spec).slice(0, 5) : []}
            />
          )}

          {step === 3 && (
            <Step3
              entries={previewEntries}
              onUpdate={(idx, patch) => setPreviewEntries(arr => arr.map((e, i) => i === idx ? { ...e, ...patch } : e))}
              onRemove={(idx) => setPreviewEntries(arr => arr.filter((_, i) => i !== idx))}
            />
          )}

          {error && <p className="text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>}
        </div>

        <footer className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 sticky bottom-0 bg-white dark:bg-slate-900 flex items-center justify-between gap-3">
          <button type="button" onClick={onClose} className="btn-secondary" disabled={pending}>Cancelar</button>
          <div className="flex items-center gap-2">
            {step > 1 && (
              <button type="button" onClick={goBack} className="btn-secondary" disabled={pending}>
                ← Atrás
              </button>
            )}
            {step < 3 && (
              <button type="button" onClick={goNext} className="btn-primary" disabled={pending}>
                Siguiente →
              </button>
            )}
            {step === 3 && (
              <button type="button" onClick={submit} className="btn-primary" disabled={pending || previewEntries.length === 0}>
                {pending ? "Creando…" : `Crear grupo (${previewEntries.length} clases)`}
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Step 1
// ─────────────────────────────────────────────────────────

function Step1(p: {
  name: string; setName: (v: string) => void;
  levels: Level[]; setLevels: (v: Level[]) => void;
  teachers: Teacher[]; teacherId: string; setTeacherId: (v: string) => void;
  capacity: number; setCapacity: (v: number) => void;
  students: Student[]; memberIds: string[]; setMemberIds: (v: string[]) => void;
  totalSessions: number | ""; setTotal: (v: number | "") => void;
}) {
  const toggleLevel = (l: Level) => {
    p.setLevels(p.levels.includes(l) ? p.levels.filter(x => x !== l) : [...p.levels, l]);
  };
  const toggleMember = (id: string) => {
    p.setMemberIds(p.memberIds.includes(id) ? p.memberIds.filter(x => x !== id) : [...p.memberIds, id]);
  };
  return (
    <div className="space-y-4">
      <Field label="Nombre del grupo">
        <input value={p.name} onChange={e => p.setName(e.target.value)} className="input-text w-full" placeholder="Ej. Deutsch A1-B1 Abends" />
      </Field>

      <Field label="Niveles que cubre el grupo">
        <div className="flex gap-1.5 flex-wrap">
          {ALL_LEVELS.map(l => (
            <button
              key={l} type="button" onClick={() => toggleLevel(l)}
              className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors ${
                p.levels.includes(l)
                  ? "border-brand-500 bg-brand-100 dark:bg-brand-500/20 text-brand-700 dark:text-brand-300"
                  : "border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-brand-400"
              }`}
            >{l}</button>
          ))}
        </div>
      </Field>

      <div className="grid sm:grid-cols-3 gap-4">
        <Field label="Profesor">
          <select value={p.teacherId} onChange={e => p.setTeacherId(e.target.value)} className="input-text w-full">
            <option value="">— elegir —</option>
            {p.teachers.map(t => (
              <option key={t.id} value={t.id}>{t.full_name ?? t.email}</option>
            ))}
          </select>
        </Field>
        <Field label="Capacidad máxima">
          <input type="number" min={1} max={50} value={p.capacity} onChange={e => p.setCapacity(Number(e.target.value))} className="input-text w-full" />
        </Field>
        <Field label="Clases totales (opcional)">
          <input type="number" min={1} max={500} value={p.totalSessions}
            onChange={e => p.setTotal(e.target.value === "" ? "" : Number(e.target.value))}
            className="input-text w-full" placeholder="Ej. 50" />
        </Field>
      </div>

      <Field label={`Miembros (${p.memberIds.length} seleccionado${p.memberIds.length === 1 ? "" : "s"})`}>
        <div className="max-h-44 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-800">
          {p.students.length === 0 && (
            <p className="p-3 text-xs text-slate-500 dark:text-slate-400">No hay estudiantes activos.</p>
          )}
          {p.students.map(s => {
            const checked = p.memberIds.includes(s.id);
            return (
              <label key={s.id} className={`flex items-center gap-3 px-3 py-2 cursor-pointer ${
                checked ? "bg-brand-50 dark:bg-brand-500/10" : "hover:bg-slate-50 dark:hover:bg-slate-800/40"
              }`}>
                <input type="checkbox" checked={checked} onChange={() => toggleMember(s.id)} className="h-4 w-4" />
                <span className="flex-1 min-w-0">
                  <span className="block text-sm text-slate-900 dark:text-slate-100 truncate">{s.full_name ?? s.email}</span>
                  <span className="block text-[11px] text-slate-500 dark:text-slate-400 truncate">{s.email} · {s.current_level}</span>
                </span>
              </label>
            );
          })}
        </div>
      </Field>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Step 2
// ─────────────────────────────────────────────────────────

function Step2(p: {
  mode: ScheduleMode; setMode: (m: ScheduleMode) => void;
  weekdays: Weekday[]; setWeekdays: (v: Weekday[]) => void;
  time: string; setTime: (v: string) => void;
  duration: number; setDuration: (v: number) => void;
  firstDate: string; setFirstDate: (v: string) => void;
  sessions: number; setSessions: (v: number) => void;
  dayOfMonth: number; setDayOfMonth: (v: number) => void;
  singleDate: string; setSingleDate: (v: string) => void;
  singleTime: string; setSingleTime: (v: string) => void;
  singleDuration: number; setSingleDur: (v: number) => void;
  customEntries: Array<{ date: string; time: string; durationMin: number }>;
  setCustomE: (v: Array<{ date: string; time: string; durationMin: number }>) => void;
  specPreview: ScheduleEntry[];
}) {
  const toggleWeekday = (d: Weekday) => {
    p.setWeekdays(p.weekdays.includes(d) ? p.weekdays.filter(x => x !== d) : [...p.weekdays, d]);
  };
  return (
    <div className="space-y-4">
      <Field label="Cómo se repiten las clases">
        <select value={p.mode} onChange={e => p.setMode(e.target.value as ScheduleMode)} className="input-text w-full">
          <option value="weekly_days">Semanal · días específicos</option>
          <option value="biweekly_days">Quincenal · días específicos</option>
          <option value="monthly_day">Mensual · mismo día del mes</option>
          <option value="custom_dates">Fechas personalizadas (estilo Zoom)</option>
          <option value="single">Una sola clase</option>
        </select>
      </Field>

      {(p.mode === "weekly_days" || p.mode === "biweekly_days") && (
        <>
          <Field label="Días de la semana">
            <div className="flex gap-1.5 flex-wrap">
              {WEEKDAY_LABELS.map(w => (
                <button key={w.id} type="button" onClick={() => toggleWeekday(w.id)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                    p.weekdays.includes(w.id)
                      ? "border-brand-500 bg-brand-100 dark:bg-brand-500/20 text-brand-700 dark:text-brand-300"
                      : "border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-brand-400"
                  }`}
                >{w.long}</button>
              ))}
            </div>
          </Field>
          <div className="grid sm:grid-cols-4 gap-4">
            <Field label="Hora (Berlín)">
              <input type="time" step={300} value={p.time} onChange={e => p.setTime(e.target.value)} className="input-text w-full" />
            </Field>
            <Field label="Duración">
              <select value={p.duration} onChange={e => p.setDuration(Number(e.target.value))} className="input-text w-full">
                {[30,45,60,75,90,105,120,150,180].map(m => <option key={m} value={m}>{m} min</option>)}
              </select>
            </Field>
            <Field label="Empieza el">
              <input type="date" value={p.firstDate} onChange={e => p.setFirstDate(e.target.value)} className="input-text w-full" />
            </Field>
            <Field label="N.º de sesiones">
              <input type="number" min={1} max={MAX_SESSIONS_PER_SCHEDULE}
                value={p.sessions} onChange={e => p.setSessions(Number(e.target.value))} className="input-text w-full" />
            </Field>
          </div>
        </>
      )}

      {p.mode === "monthly_day" && (
        <div className="grid sm:grid-cols-4 gap-4">
          <Field label="Día del mes">
            <input type="number" min={1} max={31} value={p.dayOfMonth} onChange={e => p.setDayOfMonth(Number(e.target.value))} className="input-text w-full" />
          </Field>
          <Field label="Hora (Berlín)">
            <input type="time" step={300} value={p.time} onChange={e => p.setTime(e.target.value)} className="input-text w-full" />
          </Field>
          <Field label="Duración">
            <select value={p.duration} onChange={e => p.setDuration(Number(e.target.value))} className="input-text w-full">
              {[30,45,60,75,90,105,120,150,180].map(m => <option key={m} value={m}>{m} min</option>)}
            </select>
          </Field>
          <Field label="Meses">
            <input type="number" min={1} max={MAX_SESSIONS_PER_SCHEDULE} value={p.sessions} onChange={e => p.setSessions(Number(e.target.value))} className="input-text w-full" />
          </Field>
        </div>
      )}

      {p.mode === "single" && (
        <div className="grid sm:grid-cols-3 gap-4">
          <Field label="Fecha"><input type="date" value={p.singleDate} onChange={e => p.setSingleDate(e.target.value)} className="input-text w-full" /></Field>
          <Field label="Hora (Berlín)"><input type="time" step={300} value={p.singleTime} onChange={e => p.setSingleTime(e.target.value)} className="input-text w-full" /></Field>
          <Field label="Duración">
            <select value={p.singleDuration} onChange={e => p.setSingleDur(Number(e.target.value))} className="input-text w-full">
              {[30,45,60,75,90,105,120,150,180].map(m => <option key={m} value={m}>{m} min</option>)}
            </select>
          </Field>
        </div>
      )}

      {p.mode === "custom_dates" && (
        <Field label="Fechas y horas (cada clase a su propio horario)">
          <div className="space-y-2">
            {p.customEntries.map((e, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-end">
                <input type="date" value={e.date} onChange={ev => p.setCustomE(p.customEntries.map((x, j) => j === i ? { ...x, date: ev.target.value } : x))} className="input-text" />
                <input type="time" step={300} value={e.time} onChange={ev => p.setCustomE(p.customEntries.map((x, j) => j === i ? { ...x, time: ev.target.value } : x))} className="input-text" />
                <select value={e.durationMin} onChange={ev => p.setCustomE(p.customEntries.map((x, j) => j === i ? { ...x, durationMin: Number(ev.target.value) } : x))} className="input-text">
                  {[30,45,60,75,90,105,120,150,180].map(m => <option key={m} value={m}>{m} min</option>)}
                </select>
                <button type="button" onClick={() => p.setCustomE(p.customEntries.filter((_, j) => j !== i))}
                  className="text-xs px-2 py-2 text-red-600 hover:text-red-800 dark:text-red-400" aria-label="Quitar">×</button>
              </div>
            ))}
            <button type="button" onClick={() => p.setCustomE([...p.customEntries, { date: todayIsoDate(), time: "19:00", durationMin: 60 }])}
              className="text-xs font-semibold text-brand-600 dark:text-brand-400 hover:underline">+ Añadir fecha</button>
          </div>
        </Field>
      )}

      {p.specPreview.length > 0 && (
        <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/40 p-3 text-xs text-slate-600 dark:text-slate-300">
          Vista rápida (primeras {p.specPreview.length}):
          <ul className="mt-1 grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-0.5 font-mono">
            {p.specPreview.map((e, i) => <li key={i}>{formatPreviewDate(e.scheduledAtIso)}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Step 3
// ─────────────────────────────────────────────────────────

function Step3({
  entries, onUpdate, onRemove,
}: {
  entries: ScheduleEntry[];
  onUpdate: (idx: number, patch: Partial<ScheduleEntry>) => void;
  onRemove: (idx: number) => void;
}) {
  return (
    <div>
      <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
        Revisa la lista. Puedes eliminar cualquier clase con el botón <code className="text-xs">×</code> antes de confirmar.
      </p>
      <div className="rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 dark:bg-slate-800/50">
            <tr className="text-left text-slate-600 dark:text-slate-300">
              <th className="px-3 py-2 font-semibold">#</th>
              <th className="px-3 py-2 font-semibold">Fecha y hora (Berlín)</th>
              <th className="px-3 py-2 font-semibold">Duración</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {entries.map((e, i) => (
              <tr key={i} className="text-slate-800 dark:text-slate-200">
                <td className="px-3 py-2 font-mono text-slate-500">{i + 1}</td>
                <td className="px-3 py-2 capitalize">{formatPreviewDate(e.scheduledAtIso)}</td>
                <td className="px-3 py-2">
                  <select
                    value={e.durationMin}
                    onChange={ev => onUpdate(i, { durationMin: Number(ev.target.value) })}
                    className="input-text text-xs py-1"
                  >
                    {[30,45,60,75,90,105,120,150,180].map(m => <option key={m} value={m}>{m} min</option>)}
                  </select>
                </td>
                <td className="px-3 py-2 text-right">
                  <button type="button" onClick={() => onRemove(i)}
                    className="text-red-600 hover:text-red-800 dark:text-red-400 text-base leading-none px-1"
                    aria-label="Quitar esta clase">×</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Bits
// ─────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 uppercase tracking-wide">{label}</span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

function todayIsoDate(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatPreviewDate(iso: string): string {
  return new Date(iso).toLocaleString("es-ES", {
    weekday: "short", day: "numeric", month: "short",
    hour: "2-digit", minute: "2-digit",
    timeZone: "Europe/Berlin",
  });
}
