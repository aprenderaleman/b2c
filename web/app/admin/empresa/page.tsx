import Link from "next/link";
import { Suspense } from "react";
import { requireRole } from "@/lib/rbac";
import { getEmpresaMetrics, getMonthlyReport, resolvePeriod, moneyFromCents } from "@/lib/empresa";
import type { PeriodPreset, EmpresaMetrics, MonthlyRow } from "@/lib/empresa";
import { PeriodSelector } from "./PeriodSelector";
import { AlertBanner } from "./AlertBanner";
import { RevenueChart } from "./RevenueChart";
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

  const [m, monthly] = await Promise.all([
    getEmpresaMetrics(from, to, prevFrom, prevTo),
    getMonthlyReport(8),
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

      {/* Funnel */}
      <Panel title="Embudo de conversion">
        <div className="mt-4 space-y-3">
          <FunnelBar label="Leads" count={m.funnel.leads_total} pct={100} />
          <FunnelBar
            label="Prueba agendada"
            count={m.funnel.trials_scheduled}
            pct={m.funnel.rate_lead_to_trial}
          />
          <FunnelBar
            label="Asistieron"
            count={m.funnel.trials_attended}
            pct={m.funnel.rate_trial_attendance}
            ofLabel="de agendadas"
          />
          <FunnelBar
            label="Venta cerrada"
            count={m.funnel.conversions}
            pct={m.funnel.rate_attended_to_sale}
            ofLabel="de asistentes"
          />
        </div>
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
          Conversion global lead → venta: <strong>{m.funnel.rate_lead_to_sale.toFixed(1)}%</strong>
        </p>
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
            Sin datos de gasto en ads para este periodo. Sube un CSV de Google Ads o registra gastos manualmente.
          </p>
        )}
        <AdsUpload />
      </Panel>

      {/* Charts */}
      <Panel title="Evolucion diaria">
        <div className="mt-4">
          <RevenueChart data={m.daily} />
        </div>
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

      {/* Monthly report */}
      <Panel title="Historial mensual">
        <div className="mt-4">
          <MonthlyChart data={monthly} />
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-slate-600 dark:text-slate-300 text-xs">
              <tr>
                <th className="px-3 py-2 font-medium">Mes</th>
                <th className="px-3 py-2 font-medium text-right">Ingresos</th>
                <th className="px-3 py-2 font-medium text-right">Profes</th>
                <th className="px-3 py-2 font-medium text-right">Ads</th>
                <th className="px-3 py-2 font-medium text-right">Fijos</th>
                <th className="px-3 py-2 font-medium text-right">Neto</th>
                <th className="px-3 py-2 font-medium text-right">Margen</th>
                <th className="px-3 py-2 font-medium text-right">ROAS</th>
                <th className="px-3 py-2 font-medium text-right">Leads</th>
                <th className="px-3 py-2 font-medium text-right">Conv.</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-800 dark:text-slate-200">
              {monthly.map(row => (
                <tr key={row.label} className={row.neto_cents < 0 ? "bg-red-50/50 dark:bg-red-500/5" : ""}>
                  <td className="px-3 py-2 whitespace-nowrap font-medium">{row.label}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-right font-mono">{moneyFromCents(row.revenue_cents)}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-right font-mono text-slate-500">{moneyFromCents(row.payroll_cents)}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-right font-mono text-slate-500">{moneyFromCents(row.ads_cents)}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-right font-mono text-slate-500">{moneyFromCents(row.fixed_cents)}</td>
                  <td className={`px-3 py-2 whitespace-nowrap text-right font-mono font-semibold ${row.neto_cents >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                    {moneyFromCents(row.neto_cents)}
                  </td>
                  <td className={`px-3 py-2 whitespace-nowrap text-right font-mono ${row.margen_neto_pct >= 30 ? "text-emerald-600 dark:text-emerald-400" : row.margen_neto_pct >= 0 ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400"}`}>
                    {row.margen_neto_pct.toFixed(0)}%
                  </td>
                  <td className={`px-3 py-2 whitespace-nowrap text-right font-mono ${row.roas >= 3 ? "text-emerald-600 dark:text-emerald-400" : row.roas >= 1 ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400"}`}>
                    {row.roas.toFixed(1)}x
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-right">{row.leads}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-right">{row.conversions}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-slate-300 dark:border-slate-600 text-slate-900 dark:text-slate-100 font-semibold">
              <tr>
                <td className="px-3 py-2">Total</td>
                <td className="px-3 py-2 text-right font-mono">{moneyFromCents(monthly.reduce((s, r) => s + r.revenue_cents, 0))}</td>
                <td className="px-3 py-2 text-right font-mono">{moneyFromCents(monthly.reduce((s, r) => s + r.payroll_cents, 0))}</td>
                <td className="px-3 py-2 text-right font-mono">{moneyFromCents(monthly.reduce((s, r) => s + r.ads_cents, 0))}</td>
                <td className="px-3 py-2 text-right font-mono">{moneyFromCents(monthly.reduce((s, r) => s + r.fixed_cents, 0))}</td>
                <td className={`px-3 py-2 text-right font-mono ${monthly.reduce((s, r) => s + r.neto_cents, 0) >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                  {moneyFromCents(monthly.reduce((s, r) => s + r.neto_cents, 0))}
                </td>
                <td className="px-3 py-2 text-right font-mono">
                  {(() => { const rev = monthly.reduce((s, r) => s + r.revenue_cents, 0); const net = monthly.reduce((s, r) => s + r.neto_cents, 0); return rev > 0 ? (net / rev * 100).toFixed(0) + "%" : "—"; })()}
                </td>
                <td className="px-3 py-2 text-right font-mono">
                  {(() => { const rev = monthly.reduce((s, r) => s + r.revenue_cents, 0); const ads = monthly.reduce((s, r) => s + r.ads_cents, 0); return ads > 0 ? (rev / ads).toFixed(1) + "x" : "—"; })()}
                </td>
                <td className="px-3 py-2 text-right">{monthly.reduce((s, r) => s + r.leads, 0)}</td>
                <td className="px-3 py-2 text-right">{monthly.reduce((s, r) => s + r.conversions, 0)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Panel>

      {/* Recent transactions */}
      <Panel title="Ultimos pagos">
        {m.recent_payments.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">No hay pagos registrados.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-slate-600 dark:text-slate-300 text-xs">
                <tr>
                  <th className="px-3 py-2 font-medium">Estudiante</th>
                  <th className="px-3 py-2 font-medium">Tipo</th>
                  <th className="px-3 py-2 font-medium">Monto</th>
                  <th className="px-3 py-2 font-medium">Fecha</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-800 dark:text-slate-200">
                {m.recent_payments.map(p => (
                  <tr key={p.id}>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {p.student_name ?? p.student_email}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{humanType(p.type)}</td>
                    <td className="px-3 py-2 whitespace-nowrap font-mono">
                      {moneyFromCents(p.amount_cents, p.currency)}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-xs text-slate-500">
                      {new Date(p.paid_at).toLocaleDateString("es-ES", {
                        day: "2-digit", month: "short", year: "numeric",
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </main>
  );
}

// =============================================================================
// Sub-components
// =============================================================================

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

function FunnelBar({ label, count, pct, ofLabel }: {
  label: string; count: number; pct: number; ofLabel?: string;
}) {
  const width = Math.max(2, Math.min(100, pct));
  return (
    <div>
      <div className="flex items-center justify-between text-sm mb-1">
        <span className="text-slate-700 dark:text-slate-200 font-medium">{label}</span>
        <span className="text-slate-500 dark:text-slate-400 text-xs">
          {count}
          {pct < 100 && ` (${pct.toFixed(1)}%${ofLabel ? ` ${ofLabel}` : ""})`}
        </span>
      </div>
      <div className="h-2.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
        <div
          className="h-full rounded-full bg-brand-500 transition-all"
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
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
