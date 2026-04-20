/**
 * "Abrir Hans" card — temporary version: plain external link to
 * hans.aprender-aleman.de in a new tab (no SSO, user logs in manually
 * on Hans's own /login page).
 *
 * Once hans-server is deployed to Coolify with the /auth/b2c-sso-link
 * endpoint live, swap this back to the async SSO version (see git
 * history for the original implementation that calls
 * /api/entitlements/hans-link).
 */
export function OpenHansButton() {
  return (
    <a
      href="https://hans.aprender-aleman.de"
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
          🤖
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-50">
              HANS
            </h3>
            <span className="text-[10px] font-semibold uppercase tracking-wider rounded-full bg-emerald-100 dark:bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 px-2 py-0.5">
              Starter · Incluido
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            Tu profesor de IA 24/7 — practica conversación cuando quieras,
            por texto o voz.
          </p>
          <div className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600 dark:text-brand-400">
            Abrir Hans →
          </div>
        </div>
      </div>
    </a>
  );
}
