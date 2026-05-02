"use client";

import { useState, useEffect, useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  generateSchedule,
  berlinWallClockToIso,
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
  // weekly_slots — varios horarios distintos por día de la semana
  const [slots, setSlots] = useState<Array<{ weekday: Weekday; time: string; durationMin: number }>>([
    { weekday: 4, time: "19:00", durationMin: 60 },
    { weekday: 5, time: "18:00", durationMin: 60 },
  ]);
  // Toggle "hasta agotar créditos" + caché del min calculado
  const [untilCreditsRunOut, setUntilCredits] = useState(false);
  const [creditsCap, setCreditsCap] = useState<{ min: number; details: string } | null>(null);

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
    setSlots([
      { weekday: 4, time: "19:00", durationMin: 60 },
      { weekday: 5, time: "18:00", durationMin: 60 },
    ]);
    setUntilCredits(false); setCreditsCap(null);
    setPreviewEntries([]);
    setError(null);
  }, [open, teachers]);

  // When "hasta agotar créditos" is toggled on, fetch min(remaining) for
  // the currently selected members. The actual `totalSessions` is then
  // derived from that cap PLUS the average session duration (1h = 1
  // class universal rule — a 2h session consumes 2 credits).
  useEffect(() => {
    if (!untilCreditsRunOut) { setCreditsCap(null); return; }
    if (memberIds.length === 0) {
      setCreditsCap({ min: 0, details: "Selecciona al menos un miembro en el paso 1." });
      setRSes(0);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/students/credits-min", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ student_ids: memberIds }),
        });
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setCreditsCap({ min: 0, details: `Error: ${data.message ?? data.error ?? "desconocido"}` });
          return;
        }
        const lines = (data.students as Array<{ name: string; remaining: number }>)
          .map(s => `${s.name}: ${s.remaining}`).join(" · ");
        setCreditsCap({ min: data.min, details: lines });
      } catch (e: unknown) {
        if (!cancelled) setCreditsCap({ min: 0, details: `Error: ${(e as Error).message}` });
      }
    })();
    return () => { cancelled = true; };
  }, [untilCreditsRunOut, memberIds]);

  // Derive the actual session count that fits within the credits cap,
  // honouring the "50 min = 1 academic class" rule. Recomputes whenever
  // the cap or the slot durations change so the preview stays accurate.
  useEffect(() => {
    if (!untilCreditsRunOut || !creditsCap) return;
    const cap = creditsCap.min;            // remaining academic classes
    if (cap <= 0) { setRSes(0); return; }
    if (mode === "weekly_slots") {
      // Walk slots in cycle; stop just before exceeding cap.
      const ordered = [...slots].sort((a, b) => a.weekday - b.weekday);
      if (ordered.length === 0) { setRSes(0); return; }
      let used = 0, count = 0, i = 0;
      while (count < MAX_SESSIONS_PER_SCHEDULE) {
        const next = ordered[i % ordered.length];
        const units = unitsForDuration(next.durationMin);
        if (units <= 0) break;
        if (used + units > cap) break;
        used += units; count++; i++;
      }
      setRSes(count);
    } else if (mode === "weekly_days" || mode === "biweekly_days" || mode === "monthly_day") {
      const units = unitsForDuration(duration);
      setRSes(units > 0 ? Math.floor(cap / units) : 0);
    }
  }, [untilCreditsRunOut, creditsCap, mode, slots, duration]);

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
      case "weekly_slots":
        if (slots.length === 0 || !firstDate) return null;
        return { mode: "weekly_slots", slots, firstDate, totalSessions: recurringSessions };
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
    dayOfMonth, singleDate, singleTime, singleDuration, customEntries, slots,
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
              slots={slots} setSlots={setSlots}
              untilCreditsRunOut={untilCreditsRunOut} setUntilCredits={setUntilCredits}
              creditsCap={creditsCap}
              specPreview={spec ? generateSchedule(spec).slice(0, 5) : []}
            />
          )}

          {step === 3 && (
            <Step3
              entries={previewEntries}
              onUpdate={(idx, patch) => setPreviewEntries(arr => arr.map((e, i) => i === idx ? { ...e, ...patch } : e))}
              onRemove={(idx) => setPreviewEntries(arr => arr.filter((_, i) => i !== idx))}
              onAdd={(entry) => setPreviewEntries(arr =>
                [...arr, entry].sort((a, b) => a.scheduledAtIso.localeCompare(b.scheduledAtIso)),
              )}
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
  slots: Array<{ weekday: Weekday; time: string; durationMin: number }>;
  setSlots: (v: Array<{ weekday: Weekday; time: string; durationMin: number }>) => void;
  untilCreditsRunOut: boolean; setUntilCredits: (v: boolean) => void;
  creditsCap: { min: number; details: string } | null;
  specPreview: ScheduleEntry[];
}) {
  const toggleWeekday = (d: Weekday) => {
    p.setWeekdays(p.weekdays.includes(d) ? p.weekdays.filter(x => x !== d) : [...p.weekdays, d]);
  };
  return (
    <div className="space-y-4">
      <Field label="Cómo se repiten las clases">
        <select value={p.mode} onChange={e => p.setMode(e.target.value as ScheduleMode)} className="input-text w-full">
          <option value="weekly_days">Semanal · días específicos (mismo horario)</option>
          <option value="weekly_slots">Semanal · varios slots con horarios distintos</option>
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

      {p.mode === "weekly_slots" && (
        <>
          <Field label="Slots semanales (cada día con su propio horario y duración)">
            <div className="space-y-2">
              {p.slots.map((s, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-end">
                  <select
                    value={s.weekday}
                    onChange={e => p.setSlots(p.slots.map((x, j) => j === i ? { ...x, weekday: Number(e.target.value) as Weekday } : x))}
                    className="input-text"
                    aria-label="Día de la semana"
                  >
                    {WEEKDAY_LABELS.map(w => <option key={w.id} value={w.id}>{w.long}</option>)}
                  </select>
                  <input
                    type="time" step={300}
                    value={s.time}
                    onChange={e => p.setSlots(p.slots.map((x, j) => j === i ? { ...x, time: e.target.value } : x))}
                    className="input-text"
                    aria-label="Hora"
                  />
                  <select
                    value={s.durationMin}
                    onChange={e => p.setSlots(p.slots.map((x, j) => j === i ? { ...x, durationMin: Number(e.target.value) } : x))}
                    className="input-text"
                    aria-label="Duración"
                  >
                    {[30,45,60,75,90,105,120,150,180].map(m => <option key={m} value={m}>{m} min</option>)}
                  </select>
                  <button
                    type="button"
                    onClick={() => p.setSlots(p.slots.filter((_, j) => j !== i))}
                    disabled={p.slots.length === 1}
                    className="text-xs px-2 py-2 text-red-600 hover:text-red-800 dark:text-red-400 disabled:opacity-30"
                    aria-label="Quitar slot"
                  >×</button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => p.setSlots([...p.slots, { weekday: 1, time: "19:00", durationMin: 60 }])}
                className="text-xs font-semibold text-brand-600 dark:text-brand-400 hover:underline"
              >+ Añadir slot</button>
            </div>
          </Field>
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Empieza el">
              <input type="date" value={p.firstDate} onChange={e => p.setFirstDate(e.target.value)} className="input-text w-full" />
            </Field>
            <Field label="N.º total de sesiones a generar">
              <input
                type="number" min={1} max={MAX_SESSIONS_PER_SCHEDULE}
                value={p.sessions}
                onChange={e => p.setSessions(Number(e.target.value))}
                disabled={p.untilCreditsRunOut}
                className="input-text w-full disabled:opacity-60"
              />
            </Field>
          </div>
          <label className="flex items-start gap-2 rounded-xl border border-slate-200 dark:border-slate-700 p-3 cursor-pointer">
            <input
              type="checkbox"
              checked={p.untilCreditsRunOut}
              onChange={e => p.setUntilCredits(e.target.checked)}
              className="mt-0.5 h-4 w-4"
            />
            <span className="text-xs text-slate-700 dark:text-slate-200">
              <strong>Generar hasta agotar créditos disponibles</strong>
              <span className="block text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                Calcula el mín. de <code>classes_remaining</code> entre los miembros del grupo y usa ese valor como N.º de sesiones.
                {p.untilCreditsRunOut && p.creditsCap && (
                  <span className="block mt-1 font-mono text-emerald-600 dark:text-emerald-400">
                    cap = {p.creditsCap.min} clases · {p.creditsCap.details}
                  </span>
                )}
                <span className="block mt-1 text-[10px] text-amber-700 dark:text-amber-400">
                  Regla universal: 50 min = 1 clase. Sesión de 100 min consume 2 créditos; 150 min, 3.
                </span>
              </span>
            </span>
          </label>
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
  entries, onUpdate, onRemove, onAdd,
}: {
  entries: ScheduleEntry[];
  onUpdate: (idx: number, patch: Partial<ScheduleEntry>) => void;
  onRemove: (idx: number) => void;
  onAdd:    (entry: ScheduleEntry) => void;
}) {
  // Local state for the "add a new class" row. Defaults to the day after
  // the last scheduled class (or today if the list is empty), same time
  // and duration so adding consecutive sessions is fast.
  const lastEntry = entries[entries.length - 1];
  const defaultDate = lastEntry
    ? addDaysIso(lastEntry.scheduledAtIso, 1)
    : todayIsoDate();
  const defaultTime = lastEntry
    ? berlinTimeFromIso(lastEntry.scheduledAtIso)
    : "19:00";
  const defaultDuration = lastEntry?.durationMin ?? 60;

  const [newDate, setNewDate] = useState(defaultDate);
  const [newTime, setNewTime] = useState(defaultTime);
  const [newDuration, setNewDuration] = useState<number>(defaultDuration);

  // Re-sync the "add new" inputs when the list grows so the next add
  // proposes the day after the new last entry.
  useEffect(() => {
    setNewDate(defaultDate);
    setNewTime(defaultTime);
    setNewDuration(defaultDuration);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries.length]);

  const handleAdd = () => {
    if (!newDate || !newTime) return;
    onAdd({
      scheduledAtIso: berlinWallClockToIso(newDate, newTime),
      durationMin:    newDuration,
    });
  };

  return (
    <div>
      <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
        Revisa la lista. Puedes eliminar cualquier clase con <code className="text-xs">×</code>,
        cambiar duraciones, o añadir más fechas con <strong>+ Añadir clase</strong> abajo
        (ideal para estudiantes con horarios irregulares).
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
              <tr key={`${e.scheduledAtIso}-${i}`} className="text-slate-800 dark:text-slate-200">
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
            {entries.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-4 text-center text-slate-500 dark:text-slate-400">
                  Sin clases. Añade una abajo.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Add-row */}
      <div className="mt-3 rounded-2xl border border-dashed border-brand-300 dark:border-brand-500/40 bg-brand-50/40 dark:bg-brand-500/5 p-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-300 mb-2">
          Añadir otra clase
        </p>
        <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-end">
          <label className="block">
            <span className="text-[10px] font-medium text-slate-600 dark:text-slate-300 uppercase tracking-wide">Fecha</span>
            <input
              type="date"
              value={newDate}
              onChange={e => setNewDate(e.target.value)}
              className="input-text w-full mt-1 text-xs py-1"
            />
          </label>
          <label className="block">
            <span className="text-[10px] font-medium text-slate-600 dark:text-slate-300 uppercase tracking-wide">Hora (Berlín)</span>
            <input
              type="time"
              step={300}
              value={newTime}
              onChange={e => setNewTime(e.target.value)}
              className="input-text w-full mt-1 text-xs py-1"
            />
          </label>
          <label className="block">
            <span className="text-[10px] font-medium text-slate-600 dark:text-slate-300 uppercase tracking-wide">Duración</span>
            <select
              value={newDuration}
              onChange={e => setNewDuration(Number(e.target.value))}
              className="input-text w-full mt-1 text-xs py-1"
            >
              {[30,45,60,75,90,105,120,150,180].map(m => <option key={m} value={m}>{m} min</option>)}
            </select>
          </label>
          <button
            type="button"
            onClick={handleAdd}
            disabled={!newDate || !newTime}
            className="rounded-xl bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white text-xs font-semibold px-3 py-2"
          >
            + Añadir
          </button>
        </div>
      </div>
    </div>
  );
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function berlinTimeFromIso(iso: string): string {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit", minute: "2-digit", hour12: false,
    timeZone: "Europe/Berlin",
  });
  return fmt.format(new Date(iso));
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

/** 1 academic class = 50 min (universal rule, see web/lib/finance.ts). */
function unitsForDuration(min: number): number {
  if (min < 15) return 0;
  if (min <= 75)  return 1;
  if (min <= 125) return 2;
  if (min <= 175) return 3;
  return Math.ceil(min / 50);
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
