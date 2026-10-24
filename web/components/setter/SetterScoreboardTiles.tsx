import type { SetterScoreboard } from "@/lib/setter-metrics";

/**
 * El contador del setter (Gelfis 2026-10-24): solo 3 cifras.
 * La tasa de asistencia es de TODA la academia — su misión es subirla.
 */
export function SetterScoreboardTiles({ s }: { s: SetterScoreboard }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <Tile
        label="Tasa de asistencia (academia)"
        value={s.academia.ratePct == null ? "—" : `${s.academia.ratePct}%`}
        sub={`${s.academia.asistieron} asistieron de ${s.academia.total} citas`}
        accent
      />
      <Tile
        label="Confirmados → asistieron"
        value={String(s.confirmados.asistieron)}
        sub={`de ${s.confirmados.confirmados} confirmados por ti`}
      />
      <Tile
        label="Leads rescatados"
        value={String(s.rescatados.reagendaron)}
        sub={`volvieron a agendar · ${s.rescatados.asistieron} asistieron`}
      />
    </div>
  );
}

function Tile({ label, value, sub, accent }: { label: string; value: string; sub: string; accent?: boolean }) {
  return (
    <div className={`rounded-2xl border p-4 ${
      accent
        ? "border-emerald-300 dark:border-emerald-500/40 bg-emerald-50 dark:bg-emerald-500/10"
        : "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"
    }`}>
      <p className="text-[11px] uppercase tracking-wide font-semibold text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-0.5 text-2xl font-bold text-slate-900 dark:text-slate-50 tabular-nums">{value}</p>
      <p className="text-xs text-slate-500 dark:text-slate-400">{sub}</p>
    </div>
  );
}
