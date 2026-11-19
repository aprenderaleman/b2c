import Link from "next/link";
import { NO_SHOW_WAIT_MIN, type MetricsPeriod, type TeacherMetrics } from "@/lib/teacher-metrics";

/**
 * Panel "Rendimiento" del perfil del profe (admin): embudo de clases de
 * prueba, alumnos y churn, horas invertidas y € por hora.
 * Las definiciones de cada cifra están en lib/teacher-metrics.ts.
 */

const PERIODS: Array<{ id: MetricsPeriod; label: string }> = [
  { id: "todo", label: "Todo" },
  { id: "90", label: "90 días" },
  { id: "30", label: "30 días" },
  { id: "mes", label: "Este mes" },
];

const eur = (cents: number) =>
  (cents / 100).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
const hrs = (min: number) =>
  (min / 60).toLocaleString("es-ES", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " h";
const rate = (v: number | null) => (v == null ? "—" : `${Math.round(v)} %`);

type Accent = "emerald" | "amber" | "rose" | "brand" | undefined;

export function TeacherMetricsPanel({
  teacherId, period, m,
}: {
  teacherId: string;
  period: MetricsPeriod;
  m: TeacherMetrics;
}) {
  const f = m.funnel, s = m.students, h = m.hours, e = m.earnings;
  const churnAccent: Accent = s.churnRate == null ? undefined : s.churnRate <= 15 ? "emerald" : s.churnRate <= 30 ? "amber" : "rose";
  const attAccent: Accent = f.attendanceRate == null ? undefined : f.attendanceRate >= 60 ? "emerald" : f.attendanceRate >= 45 ? "amber" : "rose";
  const convAccent: Accent = f.conversionRate == null ? undefined : f.conversionRate >= 30 ? "emerald" : f.conversionRate >= 15 ? "amber" : "rose";
  const periodLabel = PERIODS.find(p => p.id === period)?.label ?? "Todo";

  return (
    <section className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
          Rendimiento
        </h2>
        <nav className="flex items-center gap-1" aria-label="Periodo">
          {PERIODS.map(p => (
            <Link
              key={p.id}
              href={p.id === "todo" ? `/admin/profesores/${teacherId}` : `/admin/profesores/${teacherId}?periodo=${p.id}`}
              scroll={false}
              aria-current={p.id === period ? "true" : undefined}
              className={
                "rounded-full px-3 py-1 text-xs font-medium border transition-colors " +
                (p.id === period
                  ? "border-brand-500 bg-brand-500 text-white"
                  : "border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-brand-400")
              }
            >
              {p.label}
            </Link>
          ))}
        </nav>
      </div>

      {/* 1. Clases de prueba */}
      <Group title="Clases de prueba" hint={periodLabel}>
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
          <Metric label="Leads recibidos" value={String(f.leads)} />
          <Metric label="Asistieron" value={String(f.attended)} />
          <Metric label="No asistieron" value={String(f.absent)} />
          <Metric label="Tasa de asistencia" value={rate(f.attendanceRate)} accent={attAccent} />
          <Metric label="Conversiones" value={String(f.conversions)} accent="emerald" />
          <Metric label="Tasa de conversión" value={rate(f.conversionRate)} accent={convAccent} sub="sobre los que asistieron" />
        </div>
        {(f.unmarked > 0 || f.pending > 0 || f.cancelledOnly > 0) && (
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            {[
              f.pending > 0 ? `${f.pending} pendiente${f.pending === 1 ? "" : "s"} de dar` : null,
              f.unmarked > 0 ? `${f.unmarked} sin marcar asistencia` : null,
              f.cancelledOnly > 0 ? `${f.cancelledOnly} cancelada${f.cancelledOnly === 1 ? "" : "s"} antes de darse (no cuenta${f.cancelledOnly === 1 ? "" : "n"} como recibida${f.cancelledOnly === 1 ? "" : "s"})` : null,
            ].filter(Boolean).join(" · ")}
          </p>
        )}
      </Group>

      {/* 2. Alumnos */}
      <Group title="Alumnos" hint="Estado de hoy">
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
          <Metric label="Activos" value={String(s.active)} accent="emerald" />
          <Metric label="En pausa" value={String(s.paused)} />
          <Metric label="Bajas" value={String(s.churned)} accent={s.churned > 0 ? "rose" : undefined} />
          <Metric label="Churn" value={rate(s.churnRate)} accent={churnAccent} sub={`${s.churned} de ${s.active + s.paused + s.finished + s.churned}`} />
          <Metric label="Plan terminado" value={String(s.finished)} />
          <Metric label="Reasignados" value={String(s.reassigned)} sub="siguen con otro profe" />
        </div>
      </Group>

      {/* 3. Tiempo y dinero */}
      <Group title="Tiempo y dinero" hint={periodLabel}>
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          <Metric label="Horas invertidas" value={hrs(h.totalMin)} />
          <Metric label="Total ganado" value={eur(e.totalCents)} accent="brand" />
          <Metric label="Ganado por hora" value={e.perHourCents == null ? "—" : eur(e.perHourCents)} accent="brand" sub="incluye pruebas y comisiones" />
          <Metric label="Clases recurrentes" value={String(h.regularClasses)} sub={e.perClassHourCents == null ? undefined : `${eur(e.perClassHourCents)}/h solo clases`} />
        </div>

        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <Breakdown
            title="Horas"
            rows={[
              ["Pruebas asistidas", hrs(h.trialAttendedMin)],
              ["Pruebas no asistidas", hrs(h.trialAbsentMin)],
              ...(h.trialUnmarkedMin > 0 ? [["Pruebas sin marcar", hrs(h.trialUnmarkedMin)] as [string, string]] : []),
              ["Clases recurrentes", hrs(h.regularMin)],
            ]}
            total={["Total", hrs(h.totalMin)]}
          />
          <Breakdown
            title="Ingresos del profe"
            rows={[
              ["Pago por clases", eur(e.classesCents)],
              ["Comisiones y bonos", eur(e.commissionsCents)],
            ]}
            total={["Total", eur(e.totalCents)]}
          />
        </div>
      </Group>

      <p className="mt-4 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
        Un lead cuenta una vez aunque reagende. La asistencia sale de la marca «asistió / no asistió» de cada prueba.
        Churn: bajas entre todos los alumnos que ha tenido, sin contar los reasignados a otro profe.
        Horas: una prueba asistida cuenta su duración programada; una no asistida, la espera real en la sala
        ({NO_SHOW_WAIT_MIN} min si no hay registro); las clases recurrentes, los minutos de nómina.
        Las clases de prueba no se pagan: su tiempo baja el «ganado por hora».
      </p>
    </section>
  );
}

function Group({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="mt-5">
      <div className="mb-2 flex items-baseline gap-2">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
        {hint && <span className="text-xs text-slate-500 dark:text-slate-400">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function Metric({ label, value, accent, sub }: { label: string; value: string; accent?: Accent; sub?: string }) {
  const valColor =
    accent === "emerald" ? "text-emerald-600 dark:text-emerald-400" :
    accent === "amber"   ? "text-amber-600 dark:text-amber-400"     :
    accent === "rose"    ? "text-rose-600 dark:text-rose-400"       :
    accent === "brand"   ? "text-brand-600 dark:text-brand-400"     :
                           "text-slate-900 dark:text-slate-50";
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 p-3">
      <div className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${valColor}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">{sub}</div>}
    </div>
  );
}

function Breakdown({ title, rows, total }: { title: string; rows: Array<[string, string]>; total: [string, string] }) {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3">
      <div className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">{title}</div>
      <dl className="mt-1.5 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-4 py-0.5">
            <dt className="text-slate-600 dark:text-slate-300">{k}</dt>
            <dd className="tabular-nums text-slate-900 dark:text-slate-100">{v}</dd>
          </div>
        ))}
        <div className="mt-1 flex items-baseline justify-between gap-4 border-t border-slate-200 dark:border-slate-800 pt-1 font-semibold">
          <dt className="text-slate-900 dark:text-slate-100">{total[0]}</dt>
          <dd className="tabular-nums text-slate-900 dark:text-slate-100">{total[1]}</dd>
        </div>
      </dl>
    </div>
  );
}
