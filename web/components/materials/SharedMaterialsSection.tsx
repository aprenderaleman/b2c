import type { SharedMaterial, CefrLevel } from "@/lib/shared-materials";

/**
 * Displays a grouped list of shared Gamma materials: level → module →
 * lesson cards. Each card opens the deck in a new tab.
 *
 * Used inside /profesor/materiales (full A1–B2) and /estudiante/materiales
 * (filtered to the student's level and below).
 */
export function SharedMaterialsSection({
  materials,
  heading      = "Material oficial de la academia",
  description  = "Presentaciones Gamma preparadas por Aprender-Aleman.de. Clic para abrir la lección.",
}: {
  materials:   SharedMaterial[];
  heading?:    string;
  description?: string;
}) {
  if (materials.length === 0) {
    return (
      <section className="rounded-3xl border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 p-6 text-center text-sm text-slate-500 dark:text-slate-400">
        No hay material compartido disponible todavía.
      </section>
    );
  }

  // Group by level
  const byLevel: Record<string, SharedMaterial[]> = {};
  for (const m of materials) {
    (byLevel[m.level] ??= []).push(m);
  }

  return (
    <section className="space-y-5">
      <header>
        <h2 className="text-lg font-bold text-slate-900 dark:text-slate-50">{heading}</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{description}</p>
      </header>

      {Object.entries(byLevel).map(([level, items]) => (
        <LevelBlock key={level} level={level as CefrLevel} items={items} />
      ))}
    </section>
  );
}

function LevelBlock({ level, items }: { level: CefrLevel; items: SharedMaterial[] }) {
  // Sub-group by module inside a level (null module_name bucketed separately).
  const byModule: Record<string, SharedMaterial[]> = {};
  for (const m of items) {
    const key = m.module_name ?? "__ungrouped__";
    (byModule[key] ??= []).push(m);
  }

  return (
    <div className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-100 dark:border-slate-800 bg-gradient-to-r from-brand-50/70 via-white to-white dark:from-brand-500/10 dark:via-slate-900 dark:to-slate-900">
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-brand-500 text-white text-sm font-bold">
          {level}
        </span>
        <div>
          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-50">Nivel {level}</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {items.length} lección{items.length === 1 ? "" : "es"}
          </p>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {Object.entries(byModule).map(([mod, list]) => (
          <div key={mod}>
            {mod !== "__ungrouped__" && (
              <h4 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2 px-1">
                {mod}
              </h4>
            )}
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {list.map(m => <LessonCard key={m.id} m={m} />)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function LessonCard({ m }: { m: SharedMaterial }) {
  return (
    <a
      href={m.gamma_url}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex items-start gap-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 hover:border-brand-400 dark:hover:border-brand-500/50 hover:shadow-sm transition-all"
    >
      <span
        className={`shrink-0 inline-flex h-9 w-9 items-center justify-center rounded-xl text-xs font-bold tabular-nums
          ${m.is_summary
            ? "bg-amber-100 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300"
            : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 group-hover:bg-brand-100 group-hover:text-brand-700 dark:group-hover:bg-brand-500/20 dark:group-hover:text-brand-300 transition-colors"}`}
        aria-hidden
      >
        {m.is_summary ? "★" : m.lesson_number ?? "·"}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-slate-900 dark:text-slate-50 leading-snug group-hover:text-brand-700 dark:group-hover:text-brand-400 transition-colors">
          {m.title}
        </div>
        {m.subtitle && (
          <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">
            {m.subtitle}
          </div>
        )}
      </div>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="shrink-0 h-4 w-4 text-slate-400 group-hover:text-brand-500 transition-colors mt-1">
        <path d="M7 17L17 7M17 7H9M17 7v8" />
      </svg>
    </a>
  );
}
