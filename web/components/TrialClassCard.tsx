import Link from "next/link";
import {
  formatBerlinDate, formatBerlinTime, formatGoalEs, formatStatusEs,
  type TrialClassRow,
} from "@/lib/trial-classes";
import { DeleteTrialClassButton } from "./DeleteTrialClassButton";

/**
 * Card used by /admin/clasedeprueba and /profesor/clasedeprueba to show
 * a single trial class plus quick-contact buttons. Both pages share the
 * same card; the only difference is `showLeadDetailLink` (admin → yes).
 */
export function TrialClassCard({
  row,
  showLeadDetailLink = false,
}: {
  row: TrialClassRow;
  showLeadDetailLink?: boolean;
}) {
  const date = formatBerlinDate(row.scheduledAt);
  const time = formatBerlinTime(row.scheduledAt);

  // wa.me requires the digits without the leading "+".
  const waDigits = row.leadWhatsapp ? row.leadWhatsapp.replace(/[^\d]/g, "") : null;

  // We always link to /aula/{id} for "Ver aula"; the admin/teacher have
  // sessions, so the trial-cookie path isn't required for them.
  const aulaUrl = `/aula/${row.classId}`;

  return (
    <article className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {/* Date + time + status */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-slate-900 dark:text-slate-50 capitalize">
              {date}
            </span>
            <span className="text-sm text-slate-500 dark:text-slate-400">·</span>
            <span className="text-sm font-mono text-slate-700 dark:text-slate-200">{time}</span>
            <span className="text-sm text-slate-500 dark:text-slate-400">·</span>
            <span className="text-xs text-slate-500 dark:text-slate-400">{row.durationMinutes} min</span>
            <StatusPill status={row.status} />
          </div>

          {/* Lead identity */}
          <div className="mt-2">
            <div className="text-base font-bold text-slate-900 dark:text-slate-50">
              {row.leadName || "(sin nombre)"}
            </div>
            <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2 flex-wrap">
              {row.leadGermanLevel && <span>Nivel <strong className="text-slate-700 dark:text-slate-200">{row.leadGermanLevel}</strong></span>}
              {row.leadGoal && <><span>·</span><span>Objetivo: {formatGoalEs(row.leadGoal)}</span></>}
              {row.leadLanguage && <><span>·</span><span>Idioma: {row.leadLanguage.toUpperCase()}</span></>}
            </div>
          </div>

          {/* Contact lines */}
          <div className="mt-2 flex flex-col gap-0.5 text-xs text-slate-600 dark:text-slate-300">
            {row.leadEmail    && <span>📧 <span className="font-mono">{row.leadEmail}</span></span>}
            {row.leadWhatsapp && <span>💬 <span className="font-mono">{row.leadWhatsapp}</span></span>}
            {!row.leadEmail && !row.leadWhatsapp && <span className="italic text-slate-400">Sin datos de contacto</span>}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap gap-2 sm:flex-col sm:items-stretch sm:min-w-[160px]">
          {row.leadWhatsapp ? (
            <a
              href={`https://wa.me/${waDigits}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-1.5 rounded-xl
                         bg-emerald-500 hover:bg-emerald-600 text-white
                         px-3.5 py-2 text-xs font-semibold shadow-sm transition-colors"
            >
              💬 WhatsApp
            </a>
          ) : (
            <span className="inline-flex items-center justify-center gap-1.5 rounded-xl
                             bg-slate-100 dark:bg-slate-800 text-slate-400
                             px-3.5 py-2 text-xs font-semibold cursor-not-allowed">
              💬 Sin WhatsApp
            </span>
          )}

          {row.leadEmail ? (
            <a
              href={`mailto:${row.leadEmail}`}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl
                         bg-blue-500 hover:bg-blue-600 text-white
                         px-3.5 py-2 text-xs font-semibold shadow-sm transition-colors"
            >
              📧 Email
            </a>
          ) : (
            <span className="inline-flex items-center justify-center gap-1.5 rounded-xl
                             bg-slate-100 dark:bg-slate-800 text-slate-400
                             px-3.5 py-2 text-xs font-semibold cursor-not-allowed">
              📧 Sin email
            </span>
          )}

          <Link
            href={aulaUrl}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl
                       border border-slate-200 dark:border-slate-700
                       bg-white dark:bg-slate-900
                       hover:bg-slate-50 dark:hover:bg-slate-800
                       text-slate-700 dark:text-slate-200
                       px-3.5 py-2 text-xs font-semibold transition-colors"
          >
            🎥 Aula
          </Link>

          {showLeadDetailLink && row.leadId && (
            <Link
              href={`/admin/leads/${row.leadId}`}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl
                         border border-slate-200 dark:border-slate-700
                         bg-white dark:bg-slate-900
                         hover:bg-slate-50 dark:hover:bg-slate-800
                         text-slate-700 dark:text-slate-200
                         px-3.5 py-2 text-xs font-semibold transition-colors"
            >
              👤 Lead
            </Link>
          )}

          <DeleteTrialClassButton
            classId={row.classId}
            scheduledAtIso={row.scheduledAt}
          />
        </div>
      </div>

      {/* Teacher row (only useful in the admin view; teacher already
          knows it's their own class) */}
      {showLeadDetailLink && (
        <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
          Profesor: <span className="text-slate-700 dark:text-slate-200 font-medium">{row.teacherName}</span>
        </div>
      )}
    </article>
  );
}

function StatusPill({ status }: { status: string }) {
  const labels: Record<string, { label: string; cls: string }> = {
    scheduled: { label: formatStatusEs("scheduled"), cls: "bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-500/30" },
    live:      { label: formatStatusEs("live"),      cls: "bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-500/30" },
    completed: { label: formatStatusEs("completed"), cls: "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30" },
    cancelled: { label: formatStatusEs("cancelled"), cls: "bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 border-red-200 dark:border-red-500/30" },
  };
  const v = labels[status] ?? { label: status, cls: "bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700" };
  return (
    <span className={`text-[11px] font-semibold uppercase tracking-wide rounded-full border px-2 py-0.5 ${v.cls}`}>
      {v.label}
    </span>
  );
}
