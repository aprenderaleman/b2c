import type { SetterMetrics } from "@/lib/setter-metrics";

/**
 * El marcador del setter: 6 cifras. Va ARRIBA de su cola (que vea su
 * marcador) y en /admin/setters. La cobertura está al lado del delta a
 * propósito: el delta solo se puede leer con cobertura alta — llamar a
 * todos es parte del marcador, no solo rescatar a los fáciles.
 */
export function SetterMetricsBoard({ m, title }: { m: SetterMetrics; title?: string }) {
  const fmtPct = (v: number | null) => (v == null ? "—" : `${v}%`);

  return (
    <section>
      {title && (
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-2">{title}</h2>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <Tile
          label="Contactados"
          value={String(m.contactados.leadsUnicos)}
          sub={`${m.contactados.contactosTotales} contactos`}
        />
        <Tile
          label="Rescatados"
          value={String(m.rescatados.reagendados)}
          sub={`${m.rescatados.asistieron} asistieron`}
        />
        <Tile
          label="Delta asistencia"
          value={m.delta.deltaPts == null ? "—" : `${m.delta.deltaPts > 0 ? "+" : ""}${m.delta.deltaPts} pts`}
          sub={`con: ${fmtPct(m.delta.conContacto.ratePct)} · sin: ${fmtPct(m.delta.sinContacto.ratePct)}`}
        />
        <Tile
          label="Cobertura"
          value={fmtPct(m.cobertura.pct)}
          sub={`${m.cobertura.contactadas}/${m.cobertura.totalCitas} citas`}
          warn={m.cobertura.pct != null && m.cobertura.pct < 80}
        />
        <Tile
          label="Velocidad"
          value={m.velocidad.medianaHorasHabiles == null ? "—" : `${m.velocidad.medianaHorasHabiles}h`}
          sub={`mediana hábil · ${m.velocidad.muestras} citas`}
        />
        <Tile
          label="Ventas originadas"
          value={String(m.ventas)}
          sub="tras rescate"
        />
      </div>
      {m.cobertura.pct != null && m.cobertura.pct < 80 && m.cobertura.totalCitas >= 5 && (
        <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
          ⚠️ Cobertura &lt;80%: el delta de asistencia no es interpretable — hay citas del periodo sin contactar.
        </p>
      )}
    </section>
  );
}

function Tile({ label, value, sub, warn }: { label: string; value: string; sub: string; warn?: boolean }) {
  return (
    <div className={`rounded-2xl border p-3 ${
      warn
        ? "border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-500/10"
        : "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"
    }`}>
      <p className="text-[11px] uppercase tracking-wide font-semibold text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-0.5 text-xl font-bold text-slate-900 dark:text-slate-50 tabular-nums">{value}</p>
      <p className="text-xs text-slate-500 dark:text-slate-400">{sub}</p>
    </div>
  );
}
