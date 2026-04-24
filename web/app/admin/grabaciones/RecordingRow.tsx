"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * One row of the /admin/grabaciones list. Splits the link area (Ver →)
 * from the delete button so clicking the trash icon doesn't also
 * navigate. Delete is destructive: confirm dialog + full row removal
 * once the server acknowledges.
 */

export type RecordingRowItem = {
  recording_id:     string;
  status:           "processing" | "ready" | "failed";
  class_id:         string | null;
  class_title:      string;
  teacher_name:     string;
  student_names:    string[];
  // Pre-formatted server-side so this client component doesn't need
  // the formatter helpers (server-only imports).
  duration_label:   string;
  size_label:       string;
  date_label:       string;
};

export function RecordingRow({ item }: { item: RecordingRowItem }) {
  const router = useRouter();
  const [gone, setGone] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const detailHref =
    item.status === "ready"
      ? `/grabacion/${item.recording_id}`
      : item.class_id
        ? `/admin/clases/${item.class_id}`
        : "#";

  const onDelete = (e: React.MouseEvent) => {
    e.preventDefault();                                  // do NOT navigate
    e.stopPropagation();
    const msg =
      `¿Eliminar la grabación de "${item.class_title}"?\n\n` +
      `Se borrará el archivo .mp4 de R2 y la fila de la base de datos.\n` +
      `Esta acción NO se puede deshacer.`;
    if (!confirm(msg)) return;

    setError(null);
    start(async () => {
      try {
        const res = await fetch(`/api/admin/recordings/${item.recording_id}`, {
          method: "DELETE",
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setError(data?.message ?? data?.error ?? "No se pudo borrar.");
          return;
        }
        setGone(true);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error de red.");
      }
    });
  };

  if (gone) return null;

  return (
    <li className="relative group">
      <Link
        href={detailHref}
        className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4 px-5 py-4
                   hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors pr-16"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
            <StatusDot status={item.status} />
            <span className="truncate">{item.class_title}</span>
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 flex flex-wrap gap-x-2 gap-y-0.5">
            <span>{item.date_label}</span>
            <span>·</span>
            <span>Con <strong className="text-slate-700 dark:text-slate-200">{item.teacher_name}</strong></span>
            {item.student_names.length > 0 && (
              <>
                <span>·</span>
                <span className="truncate">
                  {item.student_names.slice(0, 3).join(", ")}
                  {item.student_names.length > 3 && ` +${item.student_names.length - 3}`}
                </span>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-4 shrink-0 text-xs text-slate-500 dark:text-slate-400 font-mono">
          <span>{item.duration_label}</span>
          <span className="hidden sm:inline">{item.size_label}</span>
          <span className={
            item.status === "ready"      ? "text-emerald-600 dark:text-emerald-400" :
            item.status === "processing" ? "text-amber-600 dark:text-amber-400" :
                                           "text-red-600 dark:text-red-400"
          }>
            {item.status === "ready"      ? "Ver →" :
             item.status === "processing" ? "Procesando…" :
                                            "Error"}
          </span>
        </div>
      </Link>

      {/* Trash button sits on top of the link on the far right. Always
          visible on mobile; on desktop it appears on hover to reduce
          clutter but stays tab-focusable. */}
      <button
        type="button"
        onClick={onDelete}
        disabled={pending}
        aria-label={`Borrar grabación de ${item.class_title}`}
        title="Borrar grabación (irreversible)"
        className="absolute top-1/2 right-4 -translate-y-1/2
                   h-9 w-9 inline-flex items-center justify-center rounded-full
                   text-slate-400 hover:text-red-600 hover:bg-red-50
                   dark:hover:text-red-400 dark:hover:bg-red-500/10
                   sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100
                   transition-opacity
                   disabled:opacity-50 disabled:cursor-wait"
      >
        {pending ? "…" : (
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M3 6h18" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
            <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            <line x1="10" y1="11" x2="10" y2="17" />
            <line x1="14" y1="11" x2="14" y2="17" />
          </svg>
        )}
      </button>

      {error && (
        <div className="px-5 pb-3 -mt-1 text-xs text-red-600 dark:text-red-400">
          {error}
        </div>
      )}
    </li>
  );
}

function StatusDot({ status }: { status: "processing" | "ready" | "failed" }) {
  const cls = status === "ready"      ? "bg-emerald-500" :
              status === "processing" ? "bg-amber-400 animate-pulse" :
                                        "bg-red-500";
  return <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${cls}`} aria-hidden />;
}
