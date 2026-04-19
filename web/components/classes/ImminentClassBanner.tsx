"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

/**
 * Sticky banner that appears at the top of every student/teacher page
 * when there's an imminent class (≤30 min away) or one currently live.
 * Stays visible while navigating (sits inside AppShell's header area).
 *
 * States:
 *   - >30 min:            hidden
 *   - 15-30 min:          orange banner "Tu próxima clase: en X min"
 *   - 0-15 min (room open): amber banner, pulses + "Entrar al aula" CTA
 *   - Live (class ongoing): green banner "En directo · entrar"
 *   - Just ended (+30 min): gray banner fades out
 */
export function ImminentClassBanner({
  classId,
  title,
  scheduledAt,
  durationMinutes,
}: {
  classId:         string;
  title:           string;
  scheduledAt:     string;
  durationMinutes: number;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);   // refresh every 30 s
    return () => clearInterval(t);
  }, []);

  const start = new Date(scheduledAt).getTime();
  const end   = start + durationMinutes * 60_000;
  const msUntil = start - now;
  const minUntil = Math.round(msUntil / 60_000);

  const isLive   = now >= start && now <= end;
  const isClose  = minUntil > 0 && minUntil <= 30;
  const roomOpen = now >= start - 15 * 60_000 && now <= end;

  if (!isClose && !isLive) return null;

  // Colour logic
  let tone: "info" | "warn" | "live";
  if (isLive)                tone = "live";
  else if (minUntil <= 15)   tone = "warn";
  else                       tone = "info";

  const label =
    isLive             ? "Tu clase está en directo"                         :
    minUntil <= 15     ? `El aula abre ahora — empieza en ${minUntil} min`  :
                         `Tu próxima clase en ${minUntil} min`;

  const colour =
    tone === "live" ? "bg-emerald-500 text-white" :
    tone === "warn" ? "bg-brand-500 text-white animate-pulse-soft" :
                      "bg-slate-800 text-white";

  return (
    <div className={`${colour} shadow-md`}>
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-2 flex items-center justify-between gap-3 text-xs sm:text-sm font-medium">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-base leading-none" aria-hidden>
            {tone === "live" ? "🟢" : tone === "warn" ? "⏰" : "📚"}
          </span>
          <span className="truncate">
            <strong>{title}</strong> — {label}
          </span>
        </div>
        {roomOpen ? (
          <Link
            href={`/aula/${classId}`}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-full bg-white/95 text-slate-900 hover:bg-white px-3 py-1 text-xs font-semibold transition-colors"
          >
            Entrar al aula →
          </Link>
        ) : null}
      </div>
    </div>
  );
}
