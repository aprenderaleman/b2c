import Link from "next/link";
import { Suspense } from "react";
import { requireRole } from "@/lib/rbac";
import { getEmpresaMetrics, getMonthlyReport, getPulseData, resolvePeriod, moneyFromCents } from "@/lib/empresa";
import type { PeriodPreset, PulseData } from "@/lib/empresa";
import { PeriodSelector } from "./PeriodSelector";
import { AlertBanner } from "./AlertBanner";
import { MonthlyChart } from "./MonthlyChart";
import { AdsUpload } from "./AdsUpload";

export const dynamic = "force-dynamic";
export const metadata = { title: "Empresa · Admin" };

export default async function EmpresaPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string }>;
}) {
  await requireRole(["superadmin", "admin"]);

  const sp = await searchParams;
  const preset = (sp.period ?? "month") as PeriodPreset;
  const { from, to, prevFrom, prevTo } = resolvePeriod(preset, sp.from, sp.to);

  const [m, monthly, pulse] = await Promise.all([
    getEmpresaMetrics(from, to, prevFrom, prevTo),
    getMonthlyReport(8),
    getPulseData(from, to, prevFrom, prevTo),
  ]);

  return (
    <main className="space-y-6">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Empresa</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Vista ejecutiva de rentabilidad y crecimiento
          </p>
        </div>
        <Link
          href="/admin/empresa/costes"
          className="text-xs text-brand-600 dark:text-brand-400 hover:underline"
        >
          Gestionar costes fijos →
        </Link>
      </header>

      <Suspense fallback={null}>
        <PeriodSelector current={preset} />
      </Suspense>

      <AlertBanner alerts={m.alerts} />

      {/* Pulse — critical operational metrics */}
      <PulseSection pulse={pulse} />

      {/* KPI Cards */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Beneficio Bruto"
          value={moneyFromCents(m.beneficio_bruto_cents)}
          tone={m.beneficio_bruto_cents >= 0 ? "pos" : "neg"}
          delta={deltaPct(m.beneficio_bruto_cents, m.prev_revenue_cents - m.teacher_payroll_cents)}
        />
        <KpiCard
          label="Beneficio Neto"
          value={moneyFromCents(m.beneficio_neto_cents)}
          tone={m.beneficio_neto_cents >= 0 ? "pos" : "neg"}
          delta={deltaPct(m.beneficio_neto_cents, m.prev_neto_cents)}
        />
        <KpiCard
          label="Margen Neto"
          value={`${m.margen_neto_pct.toFixed(1)}%`}
          tone={m.margen_neto_pct >= 30 ? "pos" : "neg"}
        />
        <KpiCard
          label="Ingresos"
          value={moneyFromCents(m.revenue_cents)}
          accent
          delta={deltaPct(m.revenue_cents, m.prev_revenue_cents)}
          sub={`${m.active_students} estudiantes activos`}
        />
      </section>

      {/* Monthly report — main section */}
      <Panel title="Historial mensual">
        <div className="mt-4">
          <MonthlyChart data={monthly} />
        </div>
      </Panel>

      {/* Marketing */}
      <Panel title="Marketing">
        {m.marketing.has_ads_data ? (
          <div className="mt-4 grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
            <MiniStat label="Gasto Ads" value={moneyFromCents(m.marketing.ads_spend_cents)} />
            <MiniStat label="CPL real" value={moneyFromCents(m.marketing.cpl_real_cents)} />
            <MiniStat label="CAC" value={moneyFromCents(m.marketing.cac_cents)} />
            <MiniStat label="LTV promedio" value={moneyFromCents(m.marketing.ltv_cents)} />
            <MiniStat label="LTV/CAC" value={`${m.marketing.ltv_cac_ratio.toFixed(1)}x`} />
            <MiniStat label="ROAS" value={`${m.marketing.roas.toFixed(1)}x`} />
          </div>
        ) : (
          <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
            Sin datos de gasto en ads para este periodo.
          </p>
        )}
        <AdsUpload />
      </Panel>

      {/* Costes breakdown */}
      <section className="grid gap-4 lg:grid-cols-2">
        <Panel title="Desglose de costes">
          <div className="mt-3 space-y-2 text-sm">
            <CostLine label="Nomina profesores" cents={m.teacher_payroll_cents} />
            <CostLine label="Gastos variables" cents={m.variable_expenses_cents} />
            <CostLine label="Costes fijos (prorrateados)" cents={m.fixed_costs_cents} />
            <CostLine label="Publicidad (ads)" cents={m.ads_spend_cents} />
            <div className="pt-2 border-t border-slate-200 dark:border-slate-700 flex justify-between font-semibold">
              <span>Total costes</span>
              <span className="font-mono text-red-600 dark:text-red-400">
                {moneyFromCents(m.teacher_payroll_cents + m.variable_expenses_cents + m.fixed_costs_cents + m.ads_spend_cents)}
              </span>
            </div>
          </div>
        </Panel>

        <Panel title="Ingresos por tipo">
          <div className="mt-3 space-y-2 text-sm">
            {Object.entries(m.revenue_by_type).map(([type, cents]) => (
              <div key={type} className="flex justify-between">
                <span className="text-slate-600 dark:text-slate-300">{humanType(type)}</span>
                <span className="font-mono text-slate-900 dark:text-slate-100">
                  {moneyFromCents(cents)}
                </span>
              </div>
            ))}
          </div>
        </Panel>
      </section>
    </main>
  );
}

// =============================================================================
// Sub-components
// =============================================================================

function PulseSection({ pulse }: { pulse: PulseData }) {
  const convTone = pulse.conversion_rate_pct >= 5 ? "green" : pulse.conversion_rate_pct >= 2 ? "amber" : "red";
  const retTone = pulse.retention_pct >= 70 ? "green" : pulse.retention_pct >= 40 ? "amber" : "red";
  const roasTone = pulse.roas_current >= 3 ? "green" : pulse.roas_current >= 1.5 ? "amber" : "red";
  const roasDelta = pulse.roas_prev > 0
    ? ((pulse.roas_current - pulse.roas_prev) / pulse.roas_prev * 100).toFixed(0)
    : null;

  return (
    <section className="rounded-3xl bg-slate-900 dark:bg-slate-950 border border-slate-800 p-5 text-white">
      <div className="flex items-center gap-2 mb-4">
        <span className="relative flex h-2.5 w-2.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
        </span>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-300">
          Pulso del negocio
        </h2>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {/* Conversion */}
        <div className="space-y-1">
          <div className="text-xs text-slate-400 uppercase tracking-wide">Conversion leads → venta</div>
          <div className={`text-3xl font-bold font-mono ${
            convTone === "green" ? "text-emerald-400" : convTone === "amber" ? "text-amber-400" : "text-red-400"
          }`}>
            {pulse.conversion_rate_pct.toFixed(1)}%
          </div>
          <div className="text-xs text-slate-400">
            {pulse.conversions_this_month} de {pulse.leads_this_month} leads este mes
          </div>
        </div>

        {/* Retention */}
        <div className="space-y-1">
          <div className="text-xs text-slate-400 uppercase tracking-wide">Retencion</div>
          <div className={`text-3xl font-bold font-mono ${
            retTone === "green" ? "text-emerald-400" : retTone === "amber" ? "text-amber-400" : "text-red-400"
          }`}>
            {pulse.retention_pct.toFixed(0)}%
          </div>
          <div className="text-xs text-slate-400">
            {pulse.students_retained}/{pulse.students_prev_month} estudiantes renovaron
          </div>
        </div>

        {/* ROAS */}
        <div className="space-y-1">
          <div className="text-xs text-slate-400 uppercase tracking-wide">ROAS</div>
          <div className={`text-3xl font-bold font-mono ${
            roasTone === "green" ? "text-emerald-400" : roasTone === "amber" ? "text-amber-400" : "text-red-400"
          }`}>
            {pulse.roas_current.toFixed(1)}x
          </div>
          <div className="text-xs text-slate-400">
            {moneyFromCents(pulse.ads_spend_cents)} gastados · CPL {moneyFromCents(pulse.cpl_cents)}
            {roasDelta && (
              <span className={Number(roasDelta) >= 0 ? " text-emerald-400" : " text-red-400"}>
                {" "}({Number(roasDelta) >= 0 ? "+" : ""}{roasDelta}% vs mes ant.)
              </span>
            )}
          </div>
        </div>
      </div>

      {/* At-risk students */}
      {pulse.at_risk.length > 0 && (
        <div className="mt-4 pt-4 border-t border-slate-700/50">
          <div className="flex items-center gap-2 mb-2">
            <svg className="w-4 h-4 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span className="text-xs font-semibold text-amber-400 uppercase tracking-wide">
              Estudiantes en riesgo ({pulse.at_risk.length})
            </span>
            <span className="text-xs text-slate-500 ml-auto">
              Pagaron el mes pasado pero no este mes
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {pulse.at_risk.map((s) => (
              <span
                key={s.name}
                className="inline-flex items-center gap-1.5 bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-xs"
              >
                <span className="text-slate-200 font-medium">{s.name}</span>
                <span className="text-amber-400 font-mono">{moneyFromCents(s.monthly_value_cents)}</span>
              </span>
            ))}
          </div>
          <div className="mt-2 text-xs text-slate-500">
            Valor en riesgo: <span className="text-red-400 font-mono font-semibold">
              {moneyFromCents(pulse.at_risk.reduce((s, r) => s + r.monthly_value_cents, 0))}
            </span>/mes
          </div>
        </div>
      )}
    </section>
  );
}

function KpiCard({ label, value, tone, accent, delta, sub }: {
  label: string;
  value: string;
  tone?: "pos" | "neg";
  accent?: boolean;
  delta?: string | null;
  sub?: string;
}) {
  const cls =
    accent     ? "bg-brand-50 dark:bg-brand-500/10 border-brand-200 dark:border-brand-500/30" :
    tone === "neg" ? "bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/30" :
    tone === "pos" ? "bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/30" :
                  "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800";
  const valueCls =
    accent     ? "text-brand-700 dark:text-brand-300" :
    tone === "neg" ? "text-red-700 dark:text-red-300" :
    tone === "pos" ? "text-emerald-700 dark:text-emerald-300" :
                  "text-slate-900 dark:text-slate-50";
  return (
    <div className={`rounded-2xl border p-5 ${cls}`}>
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {label}
      </div>
      <div className={`mt-2 text-2xl font-bold ${valueCls}`}>{value}</div>
      {delta && (
        <div className={`mt-1 text-xs font-medium ${
          delta.startsWith("+") ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
        }`}>
          {delta} vs periodo anterior
        </div>
      )}
      {sub && <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{sub}</div>}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
        {title}
      </h2>
      {children}
    </section>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
      <div className="text-lg font-bold text-slate-900 dark:text-slate-50 font-mono">{value}</div>
    </div>
  );
}

function CostLine({ label, cents }: { label: string; cents: number }) {
  return (
    <div className="flex justify-between">
      <span className="text-slate-600 dark:text-slate-300">{label}</span>
      <span className="font-mono text-slate-900 dark:text-slate-100">
        {moneyFromCents(cents)}
      </span>
    </div>
  );
}

function humanType(type: string): string {
  return ({
    single_class:         "Clase suelta",
    package:              "Paquete",
    subscription_payment: "Suscripcion",
    other:                "Otros",
  } as Record<string, string>)[type] ?? type;
}

function deltaPct(current: number, previous: number): string | null {
  if (previous === 0) return current > 0 ? "+100%" : null;
  const pct = ((current - previous) / Math.abs(previous)) * 100;
  if (Math.abs(pct) < 0.5) return null;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(0)}%`;
}
