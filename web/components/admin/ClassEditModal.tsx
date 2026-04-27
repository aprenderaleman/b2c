"use client";

import { useState, useTransition, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

/**
 * Admin edit modal for a single class. Supports editing either THIS
 * class only or this + every later still-scheduled instance of the
 * series (if the class has a parent_class_id). Past/completed classes
 * are never touched.
 *
 * Editable fields:
 *   - title, topic, scheduled_at, duration
 *   - teacher (reassign — `teacher_id`)
 *   - group link: "Desvincular" button clears classes.group_id
 *   - participants: only when the class is NOT linked to a group
 *     (group-driven classes get their members synced from
 *     student_group_members; per-class edits would be silently
 *     overwritten).
 *
 * For scheduled_at on a series edit, the API applies a DELTA so weekly
 * spacing is preserved.
 */

type TeacherOpt = { id: string; full_name: string | null; email: string };
type StudentOpt = { id: string; full_name: string | null; email: string; current_level: string };

type ClassInfo = {
  id:                 string;
  title:              string;
  topic:              string | null;
  scheduledAt:        string;     // ISO
  durationMinutes:    number;
  hasSeries:          boolean;
  teacherId:          string;
  groupId:            string | null;
  groupName:          string | null;
  participantIds:     string[];   // current class_participants
};

export function ClassEditModal({
  open, onClose, classInfo,
}: {
  open:     boolean;
  onClose:  () => void;
  classInfo: ClassInfo;
}) {
  const router = useRouter();

  // Pre-fill with current values
  const [title,    setTitle]    = useState(classInfo.title);
  const [topic,    setTopic]    = useState(classInfo.topic ?? "");
  const [dateStr,  setDateStr]  = useState(isoToDate(classInfo.scheduledAt));
  const [timeStr,  setTimeStr]  = useState(isoToTime(classInfo.scheduledAt));
  const [duration, setDuration] = useState<number>(classInfo.durationMinutes);
  const [scope,    setScope]    = useState<"this" | "series">("this");
  const [teacherId, setTeacherId] = useState(classInfo.teacherId);
  // `decouple` is a transient flag inside the modal session — it gets
  // sent to the API on save. The class only "decouples" once Save runs.
  const [decouple, setDecouple] = useState(false);
  const [participantIds, setParticipantIds] = useState<string[]>(classInfo.participantIds);
  const [error,    setError]    = useState<string | null>(null);
  const [pending,  start]       = useTransition();

  // Picker data
  const [teachers, setTeachers] = useState<TeacherOpt[]>([]);
  const [students, setStudents] = useState<StudentOpt[]>([]);
  const pickerLoaded = useRef(false);

  useEffect(() => {
    if (!open) return;
    setTitle(classInfo.title);
    setTopic(classInfo.topic ?? "");
    setDateStr(isoToDate(classInfo.scheduledAt));
    setTimeStr(isoToTime(classInfo.scheduledAt));
    setDuration(classInfo.durationMinutes);
    setScope("this");
    setTeacherId(classInfo.teacherId);
    setDecouple(false);
    setParticipantIds(classInfo.participantIds);
    setError(null);
  }, [open, classInfo]);

  // Lazy-load the teacher + student lists once the modal opens.
  useEffect(() => {
    if (!open || pickerLoaded.current) return;
    pickerLoaded.current = true;
    fetch("/api/admin/picker", { cache: "no-store" })
      .then(r => r.json())
      .then((d: { teachers?: TeacherOpt[]; students?: StudentOpt[] }) => {
        setTeachers(d.teachers ?? []);
        setStudents(d.students ?? []);
      })
      .catch(() => { /* leave empty — modal still works for non-member edits */ });
  }, [open]);

  if (!open) return null;

  // Effective coupling state for the modal's logic. If the user clicked
  // "Desvincular" within this session (decouple=true) we treat the
  // class as if it's already free for participant edits — Save sends
  // both flags atomically.
  const stillInGroup = !!classInfo.groupId && !decouple;

  const save = () => {
    setError(null);
    if (!title.trim()) { setError("El título es obligatorio."); return; }
    if (!dateStr || !timeStr) { setError("Indica fecha y hora."); return; }
    if (!teacherId) { setError("Selecciona un profesor."); return; }

    const scheduledAt = new Date(`${dateStr}T${timeStr}:00`).toISOString();

    const body: Record<string, unknown> = {
      scope,
      title:            title.trim(),
      topic:            topic.trim() || null,
      duration_minutes: duration,
      scheduled_at:     scheduledAt,
    };
    if (teacherId !== classInfo.teacherId) body.teacher_id = teacherId;
    if (decouple)                          body.decouple_group = true;

    // Only send participants_set if it's actually editable (i.e. the
    // class is decoupled or never had a group) AND if the set changed.
    if (!stillInGroup) {
      const currentSorted = [...classInfo.participantIds].sort();
      const newSorted     = [...participantIds].sort();
      const changed = currentSorted.length !== newSorted.length ||
                      currentSorted.some((id, i) => id !== newSorted[i]);
      if (changed) body.participants_set = participantIds;
    }

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

  const toggleParticipant = (id: string) => {
    setParticipantIds(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog" aria-modal
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-2xl rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl max-h-[92vh] overflow-y-auto">
        <header className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between sticky top-0 bg-white dark:bg-slate-900 z-10">
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-50">Editar clase</h2>
          <button
            type="button" onClick={onClose}
            className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-100 text-2xl leading-none"
            aria-label="Cerrar"
          >×</button>
        </header>

        <div className="p-6 space-y-5 text-sm">
          {/* Basic info */}
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

          {/* Teacher */}
          <label className="block">
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 uppercase tracking-wide">Profesor</span>
            <select
              value={teacherId}
              onChange={e => setTeacherId(e.target.value)}
              className="input-text w-full mt-1.5"
            >
              {/* Always include the current teacher option even if the picker hasn't loaded yet, so the modal stays usable. */}
              {teachers.length === 0 && (
                <option value={teacherId}>(profesor actual)</option>
              )}
              {teachers.map(t => (
                <option key={t.id} value={t.id}>
                  {t.full_name ?? t.email}
                </option>
              ))}
            </select>
          </label>

          {/* Group link */}
          {classInfo.groupId && (
            <fieldset className="rounded-2xl border border-slate-200 dark:border-slate-700 p-4">
              <legend className="px-2 text-xs font-semibold text-slate-700 dark:text-slate-200 uppercase tracking-wide">
                Grupo
              </legend>
              {!decouple ? (
                <div className="flex items-start justify-between gap-3 mt-2">
                  <div className="min-w-0">
                    <p className="text-sm text-slate-800 dark:text-slate-200">
                      Vinculada al grupo:{" "}
                      <Link href={`/admin/grupos/${classInfo.groupId}`} className="font-semibold text-brand-600 dark:text-brand-400 hover:underline">
                        {classInfo.groupName ?? "(sin nombre)"}
                      </Link>
                    </p>
                    <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                      Para añadir/quitar miembros, gestiona el grupo y se sincroniza a las clases futuras automáticamente.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (!confirm(
                        "¿Desvincular esta clase del grupo?\n\n" +
                        "• La clase ya no se sincronizará con los miembros del grupo.\n" +
                        "• Podrás editar los miembros uno a uno desde aquí.\n" +
                        "• El cambio se aplica al guardar.\n\n" +
                        "Si has elegido 'Esta clase y las siguientes' arriba, se desvincularán también las futuras de la serie."
                      )) return;
                      setDecouple(true);
                    }}
                    className="text-xs font-semibold rounded-full border border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-500/10 px-3 py-1.5 text-amber-800 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-500/20 whitespace-nowrap"
                  >
                    Desvincular del grupo
                  </button>
                </div>
              ) : (
                <div className="mt-2 flex items-start justify-between gap-3">
                  <p className="text-sm text-amber-800 dark:text-amber-200">
                    🔗 Se desvinculará al guardar.
                    {scope === "series" && " Aplica a esta clase y a las siguientes."}
                  </p>
                  <button
                    type="button"
                    onClick={() => setDecouple(false)}
                    className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 underline-offset-4 hover:underline whitespace-nowrap"
                  >
                    Deshacer
                  </button>
                </div>
              )}
            </fieldset>
          )}

          {/* Members */}
          <fieldset className="rounded-2xl border border-slate-200 dark:border-slate-700 p-4">
            <legend className="px-2 text-xs font-semibold text-slate-700 dark:text-slate-200 uppercase tracking-wide">
              Miembros ({participantIds.length})
            </legend>
            {stillInGroup ? (
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                Esta clase hereda los miembros del grupo. Para editarlos,{" "}
                <Link
                  href={`/admin/grupos/${classInfo.groupId}`}
                  className="font-semibold text-brand-600 dark:text-brand-400 hover:underline"
                >
                  ve al grupo →
                </Link>
                {" "}o pulsa <strong>Desvincular del grupo</strong> arriba para gestionarlos solo en esta clase.
              </p>
            ) : (
              <>
                <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
                  Marca las casillas de los estudiantes que tendrán plaza en esta clase
                  {scope === "series" ? " y en las siguientes de la serie" : ""}.
                </p>
                <div className="mt-3 max-h-56 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-800">
                  {students.length === 0 && (
                    <p className="p-3 text-xs text-slate-500 dark:text-slate-400">
                      Cargando estudiantes…
                    </p>
                  )}
                  {students.map(s => {
                    const checked = participantIds.includes(s.id);
                    return (
                      <label
                        key={s.id}
                        className={`flex items-center gap-3 px-3 py-2 cursor-pointer ${
                          checked ? "bg-brand-50 dark:bg-brand-500/10" : "hover:bg-slate-50 dark:hover:bg-slate-800/40"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleParticipant(s.id)}
                          className="h-4 w-4"
                        />
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm text-slate-900 dark:text-slate-100 truncate">
                            {s.full_name ?? s.email}
                          </span>
                          <span className="block text-[11px] text-slate-500 dark:text-slate-400 truncate">
                            {s.email} · {s.current_level}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </>
            )}
          </fieldset>

          {/* Series scope */}
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
