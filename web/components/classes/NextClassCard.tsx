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
  /**
   * If the class has already ended and the recording is ready, this is
   * the recording id — the card replaces "Entrar al aula" with a
   * "Ver grabación →" link to /grabacion/[id]. Optional because the
   * card may render before the recording row exists.
   */
  recordingId?:    string | null;
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

  // Window rules (spec 2026-04-30, no grace after end):
  //   too_early : now < start − 15 min
  //   joinable  : start − 15 min ≤ now ≤ end          (CTA stays!)
  //     └ isLive : now ≥ start                       (green big card)
  //   ended     : now > end                          (recording or "finalizada")
  const opensAt   = start - 15 * 60_000;
  const isLive    = now >= start && now <= end;
  const roomOpen  = now >= opensAt && now <= end;
  const hasEnded  = now > end;

  // Cuando la clase está en curso, el card entero se viste de verde
  // llamativo y el CTA es grande y full-width — imposible de no ver.
  // Veronica reportó 2026-04-30 que "cuando la clase ya empezó, desaparece
  // el botón de unirse — solo queda uno super pequeño y verde".
  if (isLive) {
    return (
      <section className="rounded-3xl p-6 shadow-lg
                          bg-gradient-to-br from-emerald-500 to-emerald-600
                          text-white border border-emerald-400/40">
        <div className="flex items-center gap-3 text-[11px] uppercase tracking-wider font-semibold">
          <span className="relative flex h-3 w-3" aria-hidden>
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white/80" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-white" />
          </span>
          EN DIRECTO AHORA
        </div>
        <h2 className="mt-2 text-2xl font-bold">{p.title}</h2>
        <div className="mt-1 text-sm text-white/90">
          <span className="font-mono">{formatTime(p.scheduledAt)} (Berlín)</span>
          <span className="mx-2">·</span>
          <span>{p.durationMinutes} min</span>
        </div>
        <p className="mt-1 text-xs text-white/85">{p.participantsSummary}</p>
        <Link
          href={`/aula/${p.classId}`}
          className="mt-5 block w-full text-center
                     rounded-2xl bg-white text-emerald-700
                     hover:bg-white/95
                     px-6 py-4 text-lg font-bold shadow
                     transition-all"
        >
          🎓 Entrar al aula ahora →
        </Link>
      </section>
    );
  }

  return (
    <section className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-gradient-to-br from-white to-brand-50/60 dark:from-slate-900 dark:to-brand-500/5 p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-wide text-brand-600 dark:text-brand-400">
            Próxima clase
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
          <Countdown msUntil={msUntil} isLive={false} />
          {roomOpen && (
            <Link
              href={`/aula/${p.classId}`}
              className="btn-primary text-base px-6 py-3 font-bold shadow-md"
            >
              Entrar al aula →
            </Link>
          )}
          {!roomOpen && hasEnded && p.recordingId && (
            <Link
              href={`/grabacion/${p.recordingId}`}
              className="btn-primary text-sm px-5 py-2.5"
            >
              Ver grabación →
            </Link>
          )}
          {!roomOpen && hasEnded && !p.recordingId && (
            <span className="text-xs text-slate-400">Clase finalizada</span>
          )}
          {!roomOpen && !hasEnded && (
            <Link
              href={p.detailHref}
              className="btn-secondary text-xs"
            >
              Ver detalle
            </Link>
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
