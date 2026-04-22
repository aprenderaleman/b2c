"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export type NoteItem = {
  id:           string;
  author_id:    string | null;
  author_name:  string | null;
  author_email: string;
  content:      string;
  created_at:   string;
};

/**
 * Free-form note feed for /admin/estudiantes/[id] and /admin/profesores/[id].
 *
 * Renders newest notes first. Add form at the top, timeline below.
 * Each note shows author + relative date; delete button only appears
 * when the current viewer authored the note OR is a superadmin (the
 * API enforces the same, so it's defence-in-depth).
 */
export function NotesCard({
  targetType,
  targetId,
  initialNotes,
  currentUserId,
  currentRole,
}: {
  targetType:    "student" | "teacher";
  targetId:      string;
  initialNotes:  NoteItem[];
  currentUserId: string;
  currentRole:   "admin" | "superadmin";
}) {
  const router = useRouter();
  const [notes, setNotes] = useState<NoteItem[]>(initialNotes);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start]  = useTransition();

  const submit = () => {
    setError(null);
    const content = draft.trim();
    if (!content) return;
    start(async () => {
      try {
        const res = await fetch("/api/admin/notes", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({
            target_type: targetType,
            target_id:   targetId,
            content,
          }),
        });
        const data = await res.json();
        if (!res.ok || !data.note) {
          setError(data?.message ?? data?.error ?? "No se pudo guardar la nota.");
          return;
        }
        setNotes([data.note as NoteItem, ...notes]);
        setDraft("");
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error de red.");
      }
    });
  };

  const remove = (noteId: string) => {
    if (!confirm("¿Borrar esta nota? No se puede deshacer.")) return;
    start(async () => {
      try {
        const res = await fetch(`/api/admin/notes/${noteId}`, { method: "DELETE" });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setError(data?.error ?? "No se pudo borrar.");
          return;
        }
        setNotes(notes.filter(n => n.id !== noteId));
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error de red.");
      }
    });
  };

  return (
    <section className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
          📝 Notas internas
          <span className="ml-2 text-xs font-normal text-slate-400">
            · {notes.length}
          </span>
        </h2>
        <span className="text-[11px] text-slate-500 dark:text-slate-400">
          Solo admins. El estudiante/profesor NO las ve.
        </span>
      </div>

      {/* Add form */}
      <div className="space-y-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Escribe una nota… (ej. 'prefiere horario de tarde', 'pidió ampliar pack en mayo')"
          rows={3}
          maxLength={10000}
          className="input-text w-full resize-y min-h-[72px]"
          disabled={pending}
        />
        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] text-slate-400">
            {draft.trim().length > 0 && `${draft.trim().length} caracteres`}
          </span>
          <button
            type="button"
            onClick={submit}
            disabled={pending || draft.trim().length === 0}
            className="inline-flex items-center gap-1.5 rounded-xl bg-brand-500 hover:bg-brand-600
                       text-white text-sm font-semibold px-4 py-2
                       disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            {pending ? "Guardando…" : "Añadir nota"}
          </button>
        </div>
        {error && <p className="text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>}
      </div>

      {/* Timeline */}
      <ul className="mt-4 space-y-3 divide-y divide-slate-100 dark:divide-slate-800">
        {notes.length === 0 && (
          <li className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">
            Sin notas todavía. La primera la añades arriba.
          </li>
        )}
        {notes.map(n => {
          const canDelete = n.author_id === currentUserId || currentRole === "superadmin";
          return (
            <li key={n.id} className="pt-3 first:pt-0">
              <div className="flex items-start justify-between gap-3">
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  <strong className="text-slate-700 dark:text-slate-200">
                    {n.author_name?.trim() || n.author_email || "(autor eliminado)"}
                  </strong>{" "}
                  · {formatWhen(n.created_at)}
                </div>
                {canDelete && (
                  <button
                    type="button"
                    onClick={() => remove(n.id)}
                    disabled={pending}
                    className="text-[11px] text-slate-400 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                    aria-label="Borrar nota"
                    title={currentRole === "superadmin" && n.author_id !== currentUserId
                             ? "Borrar (superadmin)" : "Borrar mi nota"}
                  >
                    🗑
                  </button>
                )}
              </div>
              <p className="mt-1 text-sm text-slate-800 dark:text-slate-100 whitespace-pre-wrap break-words leading-relaxed">
                {n.content}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** "hace 3 min · lun 21 abr 13:04" style short label. */
function formatWhen(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const diffMin = Math.round((now - d.getTime()) / 60_000);
  let rel: string;
  if (diffMin < 1)        rel = "justo ahora";
  else if (diffMin < 60)  rel = `hace ${diffMin} min`;
  else if (diffMin < 1440) rel = `hace ${Math.round(diffMin / 60)} h`;
  else                    rel = `hace ${Math.round(diffMin / 1440)} d`;

  const abs = d.toLocaleString("es-ES", {
    weekday: "short", day: "numeric", month: "short",
    hour: "2-digit", minute: "2-digit",
  });
  return `${rel} · ${abs}`;
}
