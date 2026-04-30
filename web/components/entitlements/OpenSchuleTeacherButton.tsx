import {
  SCHULE_MAINTENANCE,
  SCHULE_MAINTENANCE_TITLE_ES,
  SCHULE_MAINTENANCE_BODY_ES,
} from "@/lib/schule-maintenance";

/**
 * Teacher-flavoured "Entrar a SCHULE" card. Same SSO endpoint as
 * students. When SCHULE_MAINTENANCE=true → muestra aviso y no es
 * clicable.
 */
export function OpenSchuleTeacherButton() {
  if (SCHULE_MAINTENANCE) {
    return (
      <div
        aria-disabled="true"
        className="relative rounded-3xl
                   bg-slate-100 dark:bg-slate-900
                   border border-slate-200 dark:border-slate-800 p-5 block w-full text-left
                   opacity-80 cursor-not-allowed select-none"
      >
        <div className="flex items-start gap-4">
          <span
            className="inline-flex h-12 w-12 items-center justify-center rounded-2xl
                       bg-slate-300 dark:bg-slate-700 text-slate-600 dark:text-slate-300
                       text-2xl shadow-sm"
            aria-hidden
          >
            🛠️
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-base font-bold text-slate-700 dark:text-slate-200">
                SCHULE
              </h3>
              <span className="text-[10px] font-semibold uppercase tracking-wider rounded-full bg-amber-100 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300 px-2 py-0.5">
                {SCHULE_MAINTENANCE_TITLE_ES}
              </span>
            </div>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              {SCHULE_MAINTENANCE_BODY_ES}
            </p>
          </div>
        </div>
      </div>
    );
  }
  return (
    <a
      href="/api/entitlements/schule-open"
      target="_blank"
      rel="noopener noreferrer"
      className="group relative rounded-3xl
                 bg-gradient-to-br from-brand-50 via-white to-white
                 dark:from-brand-500/15 dark:via-slate-900 dark:to-slate-900
                 border border-brand-200 dark:border-brand-500/30 p-5 block w-full text-left
                 transition-all hover:-translate-y-1 hover:shadow-brand
                 hover:border-brand-400 dark:hover:border-brand-500"
    >
      <div className="flex items-start gap-4">
        <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-500 text-white text-2xl shadow-md" aria-hidden>
          🎓
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-50">
              SCHULE
            </h3>
            <span className="text-[10px] font-semibold uppercase tracking-wider rounded-full bg-amber-100 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300 px-2 py-0.5">
              Vista profesor
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            Entra como profesor para ver la plataforma como tus alumnos —
            ejercicios, audios, gramática y vocabulario. Útil para mandar
            tareas concretas y revisar el contenido.
          </p>
          <div className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600 dark:text-brand-400">
            Abrir SCHULE →
          </div>
        </div>
      </div>
    </a>
  );
}
