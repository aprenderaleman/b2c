/**
 * Gamified attendance streak card for the student home.
 * Pure server component (no state) — the streak only moves when a
 * class is marked completed, which happens via the teacher's end-class
 * flow, so polling isn't necessary.
 */
export function AttendanceStreakCard({
  current, best,
}: {
  current: number;
  best:    number;
}) {
  if (current === 0 && best === 0) {
    // First-class user — show a welcoming empty state instead of a zero.
    return (
      <section className="rounded-3xl border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 p-5">
        <div className="flex items-center gap-3">
          <span className="text-2xl" aria-hidden>🔥</span>
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-50">
              Empieza tu racha
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Ve a tu primera clase y empezarás a contar. ¡Cada asistencia seguida suma!
            </p>
          </div>
        </div>
      </section>
    );
  }

  const level = streakLevel(current);

  return (
    <section className={`rounded-3xl border p-5 transition-colors
      ${level.border} ${level.bg}`}>
      <div className="flex items-center gap-4">
        <div className="shrink-0 relative">
          <span className="text-4xl" aria-hidden>{level.emoji}</span>
          <span
            className={`absolute -top-1 -right-2 inline-flex items-center justify-center h-6 min-w-6 rounded-full px-1.5 text-[11px] font-bold
              ${level.badge}`}
          >
            {current}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <h2 className={`text-sm font-semibold ${level.title}`}>
            {level.label}
          </h2>
          <p className="text-xs text-slate-600 dark:text-slate-300">
            {current === 1
              ? "Has asistido a 1 clase consecutiva."
              : `Has asistido a ${current} clases consecutivas.`}
            {best > current && (
              <> · mejor racha: <strong>{best}</strong></>
            )}
          </p>
        </div>
      </div>
    </section>
  );
}

type Level = {
  emoji:  string;
  label:  string;
  bg:     string;
  border: string;
  title:  string;
  badge:  string;
};

function streakLevel(n: number): Level {
  if (n >= 20) return {
    emoji: "🏆", label: "¡Racha legendaria!",
    bg: "bg-gradient-to-br from-amber-50 to-yellow-50 dark:from-amber-500/10 dark:to-yellow-500/10",
    border: "border-amber-300 dark:border-amber-500/40",
    title: "text-amber-800 dark:text-amber-200",
    badge: "bg-amber-500 text-white",
  };
  if (n >= 10) return {
    emoji: "🔥", label: "En llamas",
    bg: "bg-gradient-to-br from-red-50 to-orange-50 dark:from-red-500/10 dark:to-orange-500/10",
    border: "border-orange-300 dark:border-orange-500/40",
    title: "text-orange-800 dark:text-orange-200",
    badge: "bg-orange-500 text-white",
  };
  if (n >= 5) return {
    emoji: "🔥", label: "Racha en marcha",
    bg: "bg-brand-50 dark:bg-brand-500/10",
    border: "border-brand-300 dark:border-brand-500/40",
    title: "text-brand-800 dark:text-brand-200",
    badge: "bg-brand-500 text-white",
  };
  return {
    emoji: "✨", label: "Empezando",
    bg: "bg-white dark:bg-slate-900",
    border: "border-slate-200 dark:border-slate-800",
    title: "text-slate-900 dark:text-slate-50",
    badge: "bg-slate-600 text-white",
  };
}
