"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Props = {
  classId:         string;
  title:           string;
  scheduledAt:     string;     // ISO
  durationMinutes: number;
  participantsSummary: string; // precomputed so the component stays dumb
  livekitRoomId:   string;
  detailHref:      string;     // teacher: /profesor/clases/[id], student: /estudiante/clases/[id]
  audience:        "teacher" | "student";
};

/**
 * The "Próxima clase" card. Shows a live countdown, highlights when the
 * class is <15 min away (room available), and offers an "Entrar al aula"
 * CTA at that point (routing to /aula/{class_id} which lands in Phase 3).
 */
export function NextClassCard(p: Props) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);

  const start = new Date(p.scheduledAt).getTime();
  const end   = start + p.durationMinutes * 60_000;
  const msUntil = start - now;

  const isLive       = now >= start && now <= end;
  const roomOpen     = now >= start - 15 * 60_000 && now <= end + 30 * 60_000;
  const hasStarted   = now >= start;

  return (
    <section className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-gradient-to-br from-white to-brand-50/60 dark:from-slate-900 dark:to-brand-500/5 p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-wide text-brand-600 dark:text-brand-400">
            {isLive ? "En curso" : "Próxima clase"}
          </div>
          <h2 className="mt-1 text-xl font-bold text-slate-900 dark:text-slate-50">
            {p.title}
          </h2>
          <div className="mt-1 flex items-center gap-3 text-sm text-slate-600 dark:text-slate-300 flex-wrap">
            <span className="capitalize">{formatDate(p.scheduledAt)}</span>
            <span>·</span>
            <span className="font-mono">{formatTime(p.scheduledAt)} (Berlín)</span>
            <span>·</span>
            <span>{p.durationMinutes} min</span>
          </div>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            {p.participantsSummary}
          </p>
        </div>

        <div className="flex flex-col items-end gap-2">
          <Countdown msUntil={msUntil} isLive={isLive} />
          {roomOpen ? (
            <Link
              href={`/aula/${p.classId}`}
              className="btn-primary text-sm"
            >
              {isLive ? "Volver al aula →" : "Entrar al aula →"}
            </Link>
          ) : (
            <Link
              href={p.detailHref}
              className="btn-secondary text-xs"
            >
              Ver detalle
            </Link>
          )}
          {hasStarted && !isLive && (
            <span className="text-xs text-slate-400">Clase finalizada</span>
          )}
        </div>
      </div>
    </section>
  );
}

function Countdown({ msUntil, isLive }: { msUntil: number; isLive: boolean }) {
  if (isLive) {
    return (
      <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 dark:bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
        <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
        EN DIRECTO
      </span>
    );
  }
  if (msUntil < 0) {
    return <span className="text-xs text-slate-400">—</span>;
  }

  const totalMin = Math.floor(msUntil / 60000);
  const days  = Math.floor(totalMin / (60 * 24));
  const hours = Math.floor((totalMin % (60 * 24)) / 60);
  const mins  = totalMin % 60;

  let label: string;
  if (days > 0)       label = `en ${days}d ${hours}h`;
  else if (hours > 0) label = `en ${hours}h ${mins}m`;
  else if (mins > 0)  label = `en ${mins} min`;
  else                label = "empieza ya";

  return (
    <span className="rounded-full bg-slate-100 dark:bg-slate-800 px-3 py-1 text-xs font-medium text-slate-700 dark:text-slate-300">
      {label}
    </span>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("es-ES", {
    weekday: "long", day: "numeric", month: "long",
    timeZone: "Europe/Berlin",
  });
}
function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-ES", {
    hour: "2-digit", minute: "2-digit",
    timeZone: "Europe/Berlin",
  });
}
