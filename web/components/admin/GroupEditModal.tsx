"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

const ALL_LEVELS = ["A0", "A1", "A2", "B1", "B2", "C1", "C2"] as const;
type Level = typeof ALL_LEVELS[number];

export type GroupMember = {
  student_id: string;
  full_name:  string | null;
  email:      string;
  level?:     string | null;
};

type Mode = "admin" | "teacher";

/**
 * Shared group-edit modal for /admin/grupos and /profesor/grupos.
 *
 * Admin mode lets you change name, levels, capacity, notes, AND add/
 * remove members against the full student roster.
 * Teacher mode is the same minus anything that changes ownership —
 * teacher_id, active flag, and teacher selector are locked, and the
 * add-student picker only lists students already in the teacher's pool.
 *
 * The API endpoints already enforce these rules server-side; this UI
 * just hides what the server would reject.
 */
export function GroupEditModal({
  open, onClose, mode, group, onSaved,
}: {
  open:    boolean;
  onClose: () => void;
  mode:    Mode;
  group: {
    id:        string;
    name:      string;
    levels:    Level[];
    capacity:  number | null;
    notes:     string | null;
    members:   GroupMember[];
  };
  onSaved?: () => void;
}) {
  const router = useRouter();
  const [name,     setName]     = useState(group.name);
  const [levels,   setLevels]   = useState<Level[]>(group.levels);
  const [capacity, setCapacity] = useState<number | "">(group.capacity ?? "");
  const [notes,    setNotes]    = useState(group.notes ?? "");
  const [members,  setMembers]  = useState<GroupMember[]>(group.members);

  const [pool,     setPool]     = useState<GroupMember[]>([]);
  const [poolLoaded, setPoolLoaded] = useState(false);
  const [poolQuery, setPoolQuery] = useState("");

  const [error,   setError]     = useState<string | null>(null);
  const [pending, start]        = useTransition();

  // Re-sync state when opening against a different group
  useEffect(() => {
    if (!open) return;
    setName(group.name);
    setLevels(group.levels);
    setCapacity(group.capacity ?? "");
    setNotes(group.notes ?? "");
    setMembers(group.members);
    setError(null);
    setPoolQuery("");
  }, [open, group]);

  // Load the pool (students available to add) once the modal opens.
  useEffect(() => {
    if (!open || poolLoaded) return;
    const url = mode === "teacher" ? "/api/teacher/picker" : "/api/admin/picker";
    fetch(url)
      .then(r => r.json())
      .then((data: { students?: Array<{ id: string; full_name: string | null; email: string; current_level?: string }> }) => {
        const students = (data.students ?? []).map(s => ({
          student_id: s.id,
          full_name:  s.full_name,
          email:      s.email,
          level:      s.current_level ?? null,
        }));
        setPool(students);
        setPoolLoaded(true);
      })
      .catch(() => setPoolLoaded(true));
  }, [open, mode, poolLoaded]);

  const memberIdSet = useMemo(() => new Set(members.map(m => m.student_id)), [members]);
  const filteredPool = useMemo(() => {
    const q = poolQuery.trim().toLowerCase();
    return pool
      .filter(s => !memberIdSet.has(s.student_id))
      .filter(s => !q || `${s.full_name ?? ""} ${s.email}`.toLowerCase().includes(q))
      .slice(0, 30);
  }, [pool, memberIdSet, poolQuery]);

  if (!open) return null;

  const apiBase = mode === "teacher"
    ? `/api/teacher/groups/${group.id}`
    : `/api/admin/groups/${group.id}`;

  const toggleLevel = (lvl: Level) => {
    setLevels(cur => cur.includes(lvl) ? cur.filter(l => l !== lvl) : [...cur, lvl]);
  };

  const addMember = (s: GroupMember) => {
    setError(null);
    start(async () => {
      const res = await fetch(`${apiBase}/members`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ student_id: s.student_id }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.message ?? data?.error ?? "No se pudo añadir.");
        return;
      }
      setMembers(m => [...m, s].sort((a, b) =>
        (a.full_name ?? a.email).localeCompare(b.full_name ?? b.email)));
      router.refresh();
    });
  };

  const removeMember = (studentId: string) => {
    setError(null);
    start(async () => {
      const res = await fetch(`${apiBase}/members/${studentId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.message ?? data?.error ?? "No se pudo quitar.");
        return;
      }
      setMembers(m => m.filter(x => x.student_id !== studentId));
      router.refresh();
    });
  };

  const saveFields = () => {
    setError(null);
    const payload: Record<string, unknown> = {
      name:     name.trim(),
      levels,
      notes:    notes.trim() || null,
    };
    if (capacity !== "") payload.capacity = Number(capacity);

    start(async () => {
      const res = await fetch(apiBase, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.message ?? data?.error ?? "No se pudo guardar.");
        return;
      }
      router.refresh();
      onSaved?.();
      onClose();
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog" aria-modal
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl">
        <header className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-50">Editar grupo</h2>
          <button
            type="button" onClick={onClose}
            className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-100 text-2xl leading-none"
            aria-label="Cerrar"
          >×</button>
        </header>

        <div className="p-6 space-y-5 text-sm">
          {/* Name */}
          <Field label="Nombre">
            <input value={name} onChange={e => setName(e.target.value)} className="input-text w-full" />
          </Field>

          {/* Levels */}
          <Field label="Niveles (uno o varios)">
            <div className="flex flex-wrap gap-2">
              {ALL_LEVELS.map(lvl => {
                const on = levels.includes(lvl);
                return (
                  <button
                    key={lvl} type="button"
                    onClick={() => toggleLevel(lvl)}
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors border
                                ${on
                                  ? "bg-brand-500 border-brand-500 text-white"
                                  : "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-brand-400"}`}
                  >
                    {lvl}
                  </button>
                );
              })}
            </div>
          </Field>

          {/* Capacity */}
          <Field label="Capacidad máxima (estudiantes)">
            <input
              type="number" min={1} max={50}
              value={capacity}
              onChange={e => setCapacity(e.target.value === "" ? "" : Number(e.target.value))}
              className="input-text w-32"
              placeholder="—"
            />
          </Field>

          {/* Notes */}
          <Field label="Notas (internas)">
            <textarea
              value={notes} onChange={e => setNotes(e.target.value)}
              rows={2} className="input-text w-full resize-y"
            />
          </Field>

          {/* Members */}
          <section className="pt-3 border-t border-slate-100 dark:border-slate-800">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Miembros <span className="text-slate-400 font-normal">· {members.length}</span>
              </h3>
            </div>

            <ul className="mt-3 divide-y divide-slate-100 dark:divide-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
              {members.length === 0 && (
                <li className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400">
                  Sin estudiantes. Añade abajo.
                </li>
              )}
              {members.map(m => (
                <li key={m.student_id} className="flex items-center justify-between px-4 py-2 gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                      {m.full_name || m.email}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 font-mono truncate">
                      {m.email}{m.level ? ` · ${m.level}` : ""}
                    </div>
                  </div>
                  <button
                    type="button" onClick={() => removeMember(m.student_id)}
                    disabled={pending}
                    className="text-xs font-medium text-red-600 dark:text-red-400 hover:underline disabled:opacity-60"
                  >Quitar</button>
                </li>
              ))}
            </ul>

            <div className="mt-3 space-y-2">
              <input
                type="search"
                value={poolQuery}
                onChange={e => setPoolQuery(e.target.value)}
                placeholder={mode === "teacher" ? "Añadir estudiante (solo de tu pool)…" : "Añadir estudiante (buscar por nombre o email)…"}
                className="input-text w-full"
              />
              {poolQuery && (
                <ul className="max-h-48 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-800">
                  {filteredPool.length === 0 && (
                    <li className="px-4 py-2 text-xs text-slate-500 dark:text-slate-400">
                      Sin resultados. {mode === "teacher" && "Si el estudiante no aparece, pide al admin que te lo asigne."}
                    </li>
                  )}
                  {filteredPool.map(s => (
                    <li key={s.student_id}>
                      <button
                        type="button"
                        onClick={() => { addMember(s); setPoolQuery(""); }}
                        disabled={pending}
                        className="w-full text-left px-4 py-2 hover:bg-brand-50/60 dark:hover:bg-slate-800/60 flex items-baseline justify-between gap-3 disabled:opacity-60"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="text-sm text-slate-900 dark:text-slate-100 block truncate">
                            {s.full_name || s.email}
                          </span>
                          <span className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                            {s.email}{s.level ? ` · ${s.level}` : ""}
                          </span>
                        </span>
                        <span className="text-xs font-semibold text-brand-600">+ Añadir</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          {error && <p className="text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>}
        </div>

        <footer className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-3 sticky bottom-0 bg-white dark:bg-slate-900">
          <button type="button" onClick={onClose} className="btn-secondary" disabled={pending}>Cancelar</button>
          <button type="button" onClick={saveFields} className="btn-primary" disabled={pending}>
            {pending ? "Guardando…" : "Guardar cambios"}
          </button>
        </footer>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 uppercase tracking-wide">{label}</span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}
