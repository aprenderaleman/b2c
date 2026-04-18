"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type TeacherOption = {
  id:        string;
  email:     string;
  full_name: string | null;
};

type StudentOption = {
  id:                  string;
  email:               string;
  full_name:           string | null;
  current_level:       string;
  subscription_status: string;
};

type Props = { open: boolean; onClose: () => void };

export function CreateClassModal({ open, onClose }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [teachers, setTeachers] = useState<TeacherOption[]>([]);
  const [students, setStudents] = useState<StudentOption[]>([]);
  const [loadingOpts, setLoadingOpts] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [type,              setType]              = useState<"individual" | "group">("individual");
  const [teacherId,         setTeacherId]         = useState("");
  const [selectedStudents,  setSelectedStudents]  = useState<string[]>([]);
  const [dateStr,           setDateStr]           = useState(""); // yyyy-mm-dd
  const [timeStr,           setTimeStr]           = useState(""); // HH:mm
  const [durationMinutes,   setDurationMinutes]   = useState<number>(60);
  const [recurrencePattern, setRecurrencePattern] = useState<"none" | "weekly" | "biweekly" | "monthly">("none");
  const [recurrenceEndDate, setRecurrenceEndDate] = useState("");
  const [title,             setTitle]             = useState("");
  const [topic,             setTopic]             = useState("");

  // Load picker options when opened.
  useEffect(() => {
    if (!open) return;
    setLoadingOpts(true);
    fetch("/api/admin/picker")
      .then(r => r.json())
      .then(data => {
        setTeachers(data.teachers ?? []);
        setStudents(data.students ?? []);
      })
      .catch(e => setError(String(e)))
      .finally(() => setLoadingOpts(false));
  }, [open]);

  // Auto-default title as the admin fills the form.
  useEffect(() => {
    if (title) return;           // user customised it already
    if (!teacherId || selectedStudents.length === 0) return;
    const t  = teachers.find(x => x.id === teacherId);
    if (type === "individual") {
      const s = students.find(x => x.id === selectedStudents[0]);
      if (t && s) setTitle(`${s.full_name ?? s.email} — Clase individual`);
    } else {
      if (t) setTitle(`Grupo con ${t.full_name ?? t.email}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teacherId, selectedStudents, type]);

  if (!open) return null;

  const toggleStudent = (id: string) => {
    setSelectedStudents(cur => {
      if (cur.includes(id)) return cur.filter(x => x !== id);
      if (type === "individual") return [id];      // single-select
      return [...cur, id];
    });
  };

  const submit = () => {
    setError(null);
    if (!teacherId) { setError("Elige un profesor."); return; }
    if (selectedStudents.length === 0) { setError("Añade al menos un estudiante."); return; }
    if (type === "individual" && selectedStudents.length !== 1) {
      setError("Una clase individual es con un solo estudiante."); return;
    }
    if (!dateStr || !timeStr) { setError("Indica fecha y hora."); return; }
    if (recurrencePattern !== "none" && !recurrenceEndDate) {
      setError("Define cuándo termina la recurrencia."); return;
    }

    // Berlin local time → UTC ISO. JS builds the Date using the browser's
    // timezone, which for Gelfis is Europe/Berlin already. Good enough.
    const scheduledAt = new Date(`${dateStr}T${timeStr}:00`).toISOString();

    startTransition(async () => {
      const res = await fetch("/api/admin/classes", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          type,
          teacherId,
          studentIds:        selectedStudents,
          scheduledAt,
          durationMinutes,
          recurrencePattern,
          recurrenceEndDate: recurrencePattern === "none" ? null : recurrenceEndDate || null,
          title:             title.trim(),
          topic:             topic.trim() || null,
          notesAdmin:        null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.message ?? body?.error ?? "Error al crear la clase.");
        return;
      }
      onClose();
      router.refresh();
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-xl rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl max-h-[92vh] overflow-y-auto">
        <header className="px-6 py-5 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-50">Agendar clase</h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Se notificará por WhatsApp al profesor y a los estudiantes.
          </p>
        </header>

        <div className="p-6 space-y-4">
          {loadingOpts && <p className="text-sm text-slate-500">Cargando opciones…</p>}

          {/* Type */}
          <Field label="Tipo de clase">
            <div className="flex gap-2">
              <TypeButton
                active={type === "individual"}
                onClick={() => { setType("individual"); setSelectedStudents(selectedStudents.slice(0, 1)); }}
                label="Individual"
              />
              <TypeButton
                active={type === "group"}
                onClick={() => setType("group")}
                label="Grupo"
              />
            </div>
          </Field>

          {/* Teacher */}
          <Field label="Profesor">
            <select value={teacherId} onChange={(e) => setTeacherId(e.target.value)} className="input-text">
              <option value="">Selecciona un profesor</option>
              {teachers.map(t => (
                <option key={t.id} value={t.id}>
                  {t.full_name ?? "—"} ({t.email})
                </option>
              ))}
            </select>
          </Field>

          {/* Students */}
          <Field label={type === "individual" ? "Estudiante" : "Estudiantes (múltiple)"}>
            <div className="max-h-48 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-800">
              {students.length === 0 && (
                <div className="px-3 py-3 text-sm text-slate-500 dark:text-slate-400">
                  No hay estudiantes activos.
                </div>
              )}
              {students.map(s => (
                <label
                  key={s.id}
                  className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-brand-50/40 dark:hover:bg-slate-800/60 transition-colors"
                >
                  <input
                    type={type === "individual" ? "radio" : "checkbox"}
                    name="student"
                    checked={selectedStudents.includes(s.id)}
                    onChange={() => toggleStudent(s.id)}
                    className="h-4 w-4 text-brand-500 focus:ring-brand-500"
                  />
                  <span className="flex-1 text-sm text-slate-800 dark:text-slate-200">
                    {s.full_name ?? s.email}
                  </span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">{s.current_level}</span>
                </label>
              ))}
            </div>
          </Field>

          {/* Date + time */}
          <div className="grid sm:grid-cols-3 gap-4">
            <Field label="Fecha">
              <input type="date"
                value={dateStr}
                onChange={(e) => setDateStr(e.target.value)}
                className="input-text"
              />
            </Field>
            <Field label="Hora (Berlín)">
              <input type="time"
                step={300}
                value={timeStr}
                onChange={(e) => setTimeStr(e.target.value)}
                className="input-text"
              />
            </Field>
            <Field label="Duración">
              <select
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(Number(e.target.value))}
                className="input-text"
              >
                {[30, 45, 60, 75, 90, 105, 120].map(m => (
                  <option key={m} value={m}>{m} min</option>
                ))}
              </select>
            </Field>
          </div>

          {/* Recurrence */}
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Recurrencia">
              <select
                value={recurrencePattern}
                onChange={(e) => setRecurrencePattern(e.target.value as typeof recurrencePattern)}
                className="input-text"
              >
                <option value="none">Sin recurrencia</option>
                <option value="weekly">Semanal</option>
                <option value="biweekly">Cada 2 semanas</option>
                <option value="monthly">Mensual</option>
              </select>
            </Field>
            {recurrencePattern !== "none" && (
              <Field label="Termina el">
                <input type="date"
                  value={recurrenceEndDate}
                  onChange={(e) => setRecurrenceEndDate(e.target.value)}
                  className="input-text"
                />
              </Field>
            )}
          </div>

          {/* Title + topic */}
          <Field label="Título">
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="input-text"
              placeholder="p. ej. 'Juan — Clase Individual B1'" maxLength={200} />
          </Field>
          <Field label="Tema (opcional)">
            <input value={topic} onChange={(e) => setTopic(e.target.value)} className="input-text"
              placeholder="p. ej. 'Perfekt vs Präteritum'" maxLength={500} />
          </Field>

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>
          )}
        </div>

        <footer className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-3">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={pending}>
            Cancelar
          </button>
          <button type="button" className="btn-primary" onClick={submit} disabled={pending || loadingOpts}>
            {pending ? "Agendando…" : "Agendar clase"}
          </button>
        </footer>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function TypeButton({ active, label, onClick }: {
  active: boolean; label: string; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors
        ${active
          ? "bg-brand-500 text-white shadow-brand"
          : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"}`}
    >
      {label}
    </button>
  );
}
