import Link from "next/link";
import { Suspense } from "react";
import { requireRole } from "@/lib/rbac";
import {
  getEmpresaMetrics,
  getMonthlyReport,
  getPulseData,
  getRevenueByStudent,
  getTeacherPayrollBreakdown,
  getLtvWithProjections,
  resolvePeriod,
  moneyFromCents,
} from "@/lib/empresa";
import type { PeriodPreset, StudentRevenue, TeacherPayrollRow, FunnelMetrics, EmpresaAlert, LtvSummary, LtvClientRow } from "@/lib/empresa";
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

  const [m, monthly, pulse, revenueByStudent, payrollBreakdown] = await Promise.all([
    getEmpresaMetrics(from, to, prevFrom, prevTo),
    getMonthlyReport(8),
    getPulseData(from, to, prevFrom, prevTo),
    getRevenueByStudent(from, to),
    getTeacherPayrollBreakdown(from, to),
  ]);

  const adsEfficiency = computeAdsScore(m.marketing.roas, m.funnel.rate_lead_to_sale);
  const ltv = await getLtvWithProjections(m.marketing.cac_cents).catch(() => ({
    ltv_real_cents: 0,
    ltv_projected_cents: 0,
    ltv_cac_real: 0,
    ltv_cac_projected: 0,
    clients: [],
  } as import("@/lib/empresa").LtvSummary));

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

      {/* ============ SECCION 1: Resumen ejecutivo ============ */}
      <Panel title="Resumen del periodo">
        <div className="mt-4 grid gap-6 lg:grid-cols-2">
          {/* Gastos */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-red-500 dark:text-red-400 mb-2">Gastos</h3>
            <div className="space-y-1.5 text-sm">
              <CostLine label="Profesores" cents={m.teacher_payroll_cents} />
              <CostLine label="Ads (Google)" cents={m.ads_spend_cents} />
              <CostLine label="Herramientas (fijos)" cents={m.fixed_costs_cents} />
              <div className="pt-1.5 border-t border-slate-200 dark:border-slate-700 flex justify-between font-semibold">
                <span>Total gastos</span>
                <span className="font-mono text-red-600 dark:text-red-400">
                  {moneyFromCents(m.teacher_payroll_cents + m.ads_spend_cents + m.fixed_costs_cents)}
                </span>
              </div>
            </div>
          </div>

          {/* Ingresos */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-emerald-500 dark:text-emerald-400 mb-2">Ingresos</h3>
            <div className="max-h-48 overflow-y-auto space-y-1 text-sm">
              {revenueByStudent.length > 0 ? (
                revenueByStudent.map((r, i) => (
                  <div key={i} className="flex justify-between gap-2">
                    <span className="text-slate-600 dark:text-slate-300 truncate">{r.student_name}</span>
                    <span className="shrink-0 text-xs text-slate-400">{humanType(r.type)}</span>
                    <span className="shrink-0 font-mono text-slate-900 dark:text-slate-100">
                      {moneyFromCents(r.amount_cents)}
                    </span>
                  </div>
                ))
              ) : (
                <p className="text-slate-400 text-xs">Sin pagos en este periodo</p>
              )}
            </div>
            <div className="pt-1.5 mt-1.5 border-t border-slate-200 dark:border-slate-700 flex justify-between font-semibold text-sm">
              <span>Total ingresos</span>
              <span className="font-mono text-emerald-600 dark:text-emerald-400">
                {moneyFromCents(m.revenue_cents)}
              </span>
            </div>
          </div>
        </div>

        {/* KPIs en fila */}
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <MiniKpi
            label="Beneficio Neto"
            value={moneyFromCents(m.beneficio_neto_cents)}
            tone={m.beneficio_neto_cents >= 0 ? "pos" : "neg"}
          />
          <MiniKpi
            label="Eficiencia Ads"
            value={`${adsEfficiency}/10`}
            tone={adsEfficiency >= 7 ? "pos" : adsEfficiency >= 4 ? "neutral" : "neg"}
          />
          <MiniKpi
            label="Tasa Conversion"
            value={`${m.funnel.rate_lead_to_sale.toFixed(1)}%`}
            tone={m.funnel.rate_lead_to_sale >= 5 ? "pos" : m.funnel.rate_lead_to_sale >= 2 ? "neutral" : "neg"}
          />
          <MiniKpi
            label="Margen Neto"
            value={`${m.margen_neto_pct.toFixed(1)}%`}
            tone={m.margen_neto_pct >= 30 ? "pos" : m.margen_neto_pct >= 10 ? "neutral" : "neg"}
          />
          <MiniKpi
            label="ROAS"
            value={`${m.marketing.roas.toFixed(1)}x`}
            tone={m.marketing.roas >= 3 ? "pos" : m.marketing.roas >= 1.5 ? "neutral" : "neg"}
          />
        </div>
      </Panel>

      {/* ============ SECCION 2: Grafico de evolucion ============ */}
      <Panel title="Evolucion del periodo">
        <div className="mt-4">
          <DailyChart daily={m.daily} />
        </div>
      </Panel>

      {/* ============ SECCION 3: Historial mensual ============ */}
      <Panel title="Historial mensual">
        <div className="mt-4">
          <MonthlyChart data={monthly} />
        </div>
      </Panel>

      {/* ============ SECCION 4: Inversion Marketing ============ */}
      <Panel title="Inversion Marketing">
        {m.marketing.has_ads_data ? (
          <div className="mt-4 grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
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

      {/* ============ SECCION 4b: LTV Real vs Proyectado ============ */}
      <Panel title="LTV — Valor de vida del cliente">
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MiniStat label="LTV Real" value={moneyFromCents(ltv.ltv_real_cents)} />
          <MiniStat label="LTV Proyectado" value={moneyFromCents(ltv.ltv_projected_cents)} />
          <MiniStat label="LTV/CAC (real)" value={`${ltv.ltv_cac_real.toFixed(1)}x`} />
          <MiniStat label="LTV/CAC (proy.)" value={`${ltv.ltv_cac_projected.toFixed(1)}x`} />
        </div>
        {ltv.clients.length > 0 && (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-700 text-left text-slate-500 dark:text-slate-400">
                  <th className="pb-2 font-medium">Cliente</th>
                  <th className="pb-2 font-medium">Tipo</th>
                  <th className="pb-2 font-medium text-right">Cobrado</th>
                  <th className="pb-2 font-medium text-right">Pendiente</th>
                  <th className="pb-2 font-medium text-right">LTV Proyectado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {ltv.clients.slice(0, 20).map((c) => (
                  <tr key={c.email}>
                    <td className="py-1.5 text-slate-700 dark:text-slate-200">{c.name}</td>
                    <td className="py-1.5 text-slate-500">
                      {c.type === "subscription" ? "Suscripcion" : "Pack unico"}
                    </td>
                    <td className="py-1.5 text-right font-mono text-slate-700 dark:text-slate-200">
                      {moneyFromCents(c.paid_cents)}
                    </td>
                    <td className="py-1.5 text-right font-mono text-amber-600 dark:text-amber-400">
                      {c.pending_cents > 0 ? moneyFromCents(c.pending_cents) : "—"}
                    </td>
                    <td className="py-1.5 text-right font-mono font-semibold text-slate-900 dark:text-slate-100">
                      {moneyFromCents(c.ltv_projected_cents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {ltv.clients.length > 20 && (
              <p className="mt-2 text-xs text-slate-400">Mostrando top 20 de {ltv.clients.length} clientes</p>
            )}
          </div>
        )}
      </Panel>

      {/* ============ SECCION 5: Nominas profesores ============ */}
      <Panel title="Nominas profesores">
        {payrollBreakdown.length > 0 ? (
          <div className="mt-3 space-y-2 text-sm">
            {payrollBreakdown.map((t) => (
              <div key={t.teacher_name} className="flex justify-between items-center">
                <div>
                  <span className="text-slate-700 dark:text-slate-200 font-medium">{t.teacher_name}</span>
                  <span className="text-xs text-slate-400 ml-2">{t.hours}h</span>
                </div>
                <span className="font-mono text-slate-900 dark:text-slate-100">
                  {moneyFromCents(t.total_cents)}
                </span>
              </div>
            ))}
            <div className="pt-2 border-t border-slate-200 dark:border-slate-700 flex justify-between font-semibold">
              <span>Total nomina</span>
              <span className="font-mono text-slate-900 dark:text-slate-100">
                {moneyFromCents(payrollBreakdown.reduce((s, t) => s + t.total_cents, 0))}
              </span>
            </div>
          </div>
        ) : (
          <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
            Sin registros de horas en este periodo.
          </p>
        )}
      </Panel>

      {/* ============ SECCION 6: Datos del funnel ============ */}
      <Panel title="Funnel de ventas">
        <FunnelSection funnel={m.funnel} />
      </Panel>

      {/* ============ SECCION 7: Alertas y consejos ============ */}
      <Panel title="Alertas y consejos">
        {m.alerts.length > 0 ? (
          <div className="mt-3">
            <AlertBanner alerts={m.alerts} />
          </div>
        ) : (
          <p className="mt-3 text-sm text-emerald-600 dark:text-emerald-400 font-medium">
            Todo en orden — sin alertas activas.
          </p>
        )}
      </Panel>
    </main>
  );
}

// =============================================================================
// Sub-components
// =============================================================================

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

function MiniKpi({ label, value, tone }: {
  label: string;
  value: string;
  tone: "pos" | "neg" | "neutral";
}) {
  const cls =
    tone === "pos" ? "bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/30" :
    tone === "neg" ? "bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/30" :
                     "bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/30";
  const valueCls =
    tone === "pos" ? "text-emerald-700 dark:text-emerald-300" :
    tone === "neg" ? "text-red-700 dark:text-red-300" :
                     "text-amber-700 dark:text-amber-300";
  return (
    <div className={`rounded-xl border p-3 ${cls}`}>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</div>
      <div className={`mt-1 text-lg font-bold font-mono ${valueCls}`}>{value}</div>
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

function FunnelSection({ funnel }: { funnel: FunnelMetrics }) {
  const steps = [
    { label: "Leads", value: funnel.leads_total, rate: null },
    { label: "Prueba agendada", value: funnel.trials_scheduled, rate: funnel.rate_lead_to_trial },
    { label: "Asistio", value: funnel.trials_attended, rate: funnel.rate_trial_attendance },
    { label: "Compro", value: funnel.conversions, rate: funnel.rate_attended_to_sale },
  ];
  const max = Math.max(funnel.leads_total, 1);

  return (
    <div className="mt-4 space-y-3">
      {steps.map((s, i) => (
        <div key={s.label}>
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-slate-600 dark:text-slate-300 font-medium">{s.label}</span>
            <span className="text-slate-500">
              {s.value}
              {s.rate !== null && (
                <span className="ml-1 text-slate-400">({s.rate.toFixed(0)}%)</span>
              )}
            </span>
          </div>
          <div className="h-5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full bg-brand-500 dark:bg-brand-400 transition-all"
              style={{ width: `${Math.max((s.value / max) * 100, 2)}%` }}
            />
          </div>
        </div>
      ))}
      <div className="pt-2 border-t border-slate-200 dark:border-slate-700 text-xs text-slate-500">
        Tasa total lead → venta: <span className="font-semibold text-slate-700 dark:text-slate-200">{funnel.rate_lead_to_sale.toFixed(1)}%</span>
      </div>
    </div>
  );
}

function DailyChart({ daily }: { daily: { date: string; leads: number; revenue_cents: number }[] }) {
  if (daily.length === 0) return <p className="text-sm text-slate-400">Sin datos para este periodo.</p>;
  const maxRev = Math.max(...daily.map(d => d.revenue_cents), 1);
  const maxLeads = Math.max(...daily.map(d => d.leads), 1);

  return (
    <div className="space-y-1">
      <div className="flex gap-4 text-[10px] text-slate-400 mb-2">
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-2 bg-emerald-400 rounded" /> Ingresos</span>
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-2 bg-blue-400 rounded" /> Leads</span>
      </div>
      <div className="flex items-end gap-px h-32">
        {daily.map((d) => (
          <div key={d.date} className="flex-1 flex flex-col items-center justify-end h-full gap-px group relative">
            <div
              className="w-full bg-blue-400/60 rounded-t-sm min-h-[1px]"
              style={{ height: `${(d.leads / maxLeads) * 40}%` }}
            />
            <div
              className="w-full bg-emerald-400 rounded-t-sm min-h-[1px]"
              style={{ height: `${(d.revenue_cents / maxRev) * 60}%` }}
            />
            <div className="absolute bottom-full mb-1 hidden group-hover:block bg-slate-800 text-white text-[10px] rounded px-1.5 py-0.5 whitespace-nowrap z-10">
              {d.date.slice(5)} · {moneyFromCents(d.revenue_cents)} · {d.leads} leads
            </div>
          </div>
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-slate-400 mt-1">
        <span>{daily[0]?.date.slice(5)}</span>
        <span>{daily[daily.length - 1]?.date.slice(5)}</span>
      </div>
    </div>
  );
}

function humanType(type: string): string {
  return ({
    single_class:         "Clase",
    package:              "Pack",
    subscription_payment: "Suscr.",
    other:                "Otro",
  } as Record<string, string>)[type] ?? type;
}

function computeAdsScore(roas: number, conversionRate: number): number {
  // Scale 1-10: combines ROAS (weight 60%) and conversion rate (weight 40%)
  const roasScore = Math.min(roas / 5, 1) * 6; // ROAS 5x = max 6 points
  const convScore = Math.min(conversionRate / 10, 1) * 4; // 10% conv = max 4 points
  return Math.max(1, Math.min(10, Math.round(roasScore + convScore)));
}
