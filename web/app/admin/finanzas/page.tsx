import Link from "next/link";
import { requireRole } from "@/lib/rbac";
import { supabaseAdmin } from "@/lib/supabase";
import { formatMonthEs, getAllEarningsForMonth, getTotalRevenue, moneyFromCents } from "@/lib/finance";
import { FinanceMonthPicker } from "./MonthPicker";

export const dynamic = "force-dynamic";
export const metadata = { title: "Finanzas · Admin" };

export default async function FinanzasPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  // Superadmin-only. Regular admin sees nothing sensitive.
  await requireRole(["superadmin", "admin"]);

  const sp = await searchParams;
  const now = new Date();
  const focus = sp.month ? new Date(sp.month + "-01T00:00:00Z") : now;

  const monthStart = new Date(Date.UTC(focus.getUTCFullYear(), focus.getUTCMonth(), 1));
  const monthEnd   = new Date(Date.UTC(focus.getUTCFullYear(), focus.getUTCMonth() + 1, 1));
  const monthStr   = monthStart.toISOString().slice(0, 7);

  const [revenueMonth, revenueYear, earnings, activeStudents] = await Promise.all([
    getTotalRevenue(monthStart, monthEnd),
    getTotalRevenue(
      new Date(Date.UTC(focus.getUTCFullYear(), 0, 1)),
      new Date(Date.UTC(focus.getUTCFullYear() + 1, 0, 1)),
    ),
    getAllEarningsForMonth(focus),
    countActiveSubscriptions(),
  ]);

  const teacherPayrollCents = earnings.reduce((s, e) => s + e.amount_cents, 0);
  const unpaidPayrollCents  = earnings.filter(e => !e.paid).reduce((s, e) => s + e.amount_cents, 0);
  const netProfitCents      = revenueMonth.revenue_cents - teacherPayrollCents;

  return (
    <main className="space-y-6">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Finanzas</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Vista de <span className="capitalize">{formatMonthEs(monthStart.toISOString())}</span>
          </p>
        </div>
        <FinanceMonthPicker currentMonth={monthStr} />
      </header>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Ingresos este mes"   value={moneyFromCents(revenueMonth.revenue_cents, revenueMonth.currency)} accent />
        <Stat label="Pagos a profesores"  value={moneyFromCents(teacherPayrollCents, "EUR")} />
        <Stat label="Beneficio neto"       value={moneyFromCents(netProfitCents, revenueMonth.currency)} tone={netProfitCents >= 0 ? "pos" : "neg"} />
        <Stat label="Estudiantes activos" value={activeStudents.toString()} />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Panel title="Ingresos del año">
          <div className="text-3xl font-bold text-slate-900 dark:text-slate-50 mt-1">
            {moneyFromCents(revenueYear.revenue_cents, revenueYear.currency)}
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {revenueYear.payment_count} pago{revenueYear.payment_count === 1 ? "" : "s"} en {focus.getUTCFullYear()}
          </p>
          {Object.keys(revenueYear.by_type).length > 0 && (
            <ul className="mt-3 space-y-1 text-sm">
              {Object.entries(revenueYear.by_type).map(([type, cents]) => (
                <li key={type} className="flex items-center justify-between gap-4">
                  <span className="text-slate-600 dark:text-slate-300">{humanType(type)}</span>
                  <span className="font-mono text-slate-900 dark:text-slate-100">{moneyFromCents(cents, revenueYear.currency)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Nómina del mes">
          <div className="text-3xl font-bold text-slate-900 dark:text-slate-50 mt-1">
            {moneyFromCents(unpaidPayrollCents, "EUR")}
          </div>
          <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
            Pendiente de pagar · {earnings.filter(e => !e.paid).length} profesor(es)
          </p>
          <Link
            href="/admin/finanzas/profesores"
            className="mt-3 inline-block text-xs text-brand-600 dark:text-brand-400 hover:underline"
          >
            Ver detalle y marcar como pagado →
          </Link>
        </Panel>
      </section>

      <section className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
            Profesores este mes
          </h2>
          <Link href="/admin/finanzas/profesores" className="text-xs text-brand-600 dark:text-brand-400 hover:underline">Ver todos →</Link>
        </div>
        {earnings.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
            Aún no hay horas registradas este mes.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-slate-600 dark:text-slate-300 text-xs">
                <tr>
                  <Th>Profesor</Th>
                  <Th>Clases</Th>
                  <Th>Horas</Th>
                  <Th>Ganancia</Th>
                  <Th>Estado</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-800 dark:text-slate-200">
                {earnings.map(e => (
                  <tr key={e.teacher_id}>
                    <Td>{e.teacher_name ?? e.teacher_email}</Td>
                    <Td>{e.classes_count}</Td>
                    <Td>{(e.total_minutes / 60).toFixed(1)} h</Td>
                    <Td className="font-mono">{moneyFromCents(e.amount_cents, e.currency)}</Td>
                    <Td>
                      {e.paid ? (
                        <span className="text-xs text-emerald-700 dark:text-emerald-300">Pagado</span>
                      ) : (
                        <span className="text-xs text-amber-700 dark:text-amber-300">Pendiente</span>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

async function countActiveSubscriptions(): Promise<number> {
  const sb = supabaseAdmin();
  const { count } = await sb
    .from("students")
    .select("id", { count: "exact", head: true })
    .eq("subscription_status", "active");
  return count ?? 0;
}

function Stat({ label, value, accent, tone }: {
  label: string; value: string; accent?: boolean; tone?: "pos" | "neg";
}) {
  const cls =
    accent      ? "bg-brand-50 dark:bg-brand-500/10 border-brand-200 dark:border-brand-500/30" :
    tone === "neg" ? "bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/30" :
                  "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800";
  const valueCls =
    accent      ? "text-brand-700 dark:text-brand-300" :
    tone === "neg" ? "text-red-700 dark:text-red-300" :
    tone === "pos" ? "text-emerald-700 dark:text-emerald-300" :
                  "text-slate-900 dark:text-slate-50";
  return (
    <div className={`rounded-2xl border p-5 ${cls}`}>
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</div>
      <div className={`mt-2 text-2xl font-bold ${valueCls}`}>{value}</div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">{title}</h2>
      {children}
    </section>
  );
}

function humanType(type: string): string {
  return ({
    single_class:          "Clase suelta",
    package:               "Paquete",
    subscription_payment:  "Suscripción",
    other:                 "Otros",
  } as Record<string, string>)[type] ?? type;
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-2 font-medium whitespace-nowrap">{children}</th>;
}
function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 whitespace-nowrap ${className}`}>{children}</td>;
}
