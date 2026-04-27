"use client";

import { useState } from "react";
import { GroupEditModal, type GroupMember } from "@/components/admin/GroupEditModal";

type Level = "A0" | "A1" | "A2" | "B1" | "B2" | "C1" | "C2";

export type TeacherGroup = {
  id:             string;
  name:           string;
  class_type:     "group" | "individual";
  levels:         Level[];
  capacity:       number | null;
  notes:          string | null;
  total_sessions: number | null;
  members:        GroupMember[];
};

export function TeacherGroupsList({ groups }: { groups: TeacherGroup[] }) {
  const [editing, setEditing] = useState<TeacherGroup | null>(null);

  if (groups.length === 0) {
    return (
      <section className="rounded-3xl border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 p-6 text-center">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Aún no tienes grupos asignados. El admin te los asigna desde <code className="text-xs">/admin/grupos</code>.
        </p>
      </section>
    );
  }

  return (
    <>
      <div className="grid gap-3 lg:grid-cols-2">
        {groups.map(g => (
          <article
            key={g.id}
            className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3"
          >
            <header className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-50 truncate">{g.name}</h3>
                <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 flex-wrap">
                  <span className="capitalize">{g.class_type === "individual" ? "Individual" : "Grupal"}</span>
                  {g.levels.length > 0 && <><span>·</span><span>{g.levels.join(", ")}</span></>}
                  <span>·</span>
                  <span>{g.members.length}{g.capacity ? `/${g.capacity}` : ""} alumno{g.members.length === 1 ? "" : "s"}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditing(g)}
                className="shrink-0 text-xs rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1 text-slate-600 dark:text-slate-300 hover:border-brand-400 hover:text-brand-600"
              >
                Editar
              </button>
            </header>

            {g.members.length > 0 && (
              <ul className="text-xs space-y-1 max-h-40 overflow-y-auto">
                {g.members.slice(0, 8).map(m => (
                  <li key={m.student_id} className="flex items-center justify-between gap-2 text-slate-600 dark:text-slate-300">
                    <span className="truncate">{m.full_name || m.email}</span>
                    {m.level && <span className="text-[10px] text-slate-400 font-mono">{m.level}</span>}
                  </li>
                ))}
                {g.members.length > 8 && (
                  <li className="text-[11px] text-slate-400">… y {g.members.length - 8} más</li>
                )}
              </ul>
            )}
          </article>
        ))}
      </div>

      {editing && (
        <GroupEditModal
          open={true}
          mode="teacher"
          group={{
            id:             editing.id,
            name:           editing.name,
            levels:         editing.levels,
            capacity:       editing.capacity,
            notes:          editing.notes,
            total_sessions: editing.total_sessions,
            members:        editing.members,
          }}
          onClose={() => setEditing(null)}
          onSaved={() => setEditing(null)}
        />
      )}
    </>
  );
}
