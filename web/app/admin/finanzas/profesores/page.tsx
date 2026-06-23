import Link from "next/link";
import { requireRole } from "@/lib/rbac";
import { formatMonthEs, getAllEarningsForMonth, moneyFromCents } from "@/lib/finance";
import { getAllTeacherCloseRates, type TeacherCloseRate } from "@/lib/trial-compensation";
import { PayToggle } from "./PayToggle";
import { PayrollMonthPicker } from "./MonthPicker";

export const dynamic = "force-dynamic";
export const metadata = { title: "Nómina · Admin" };

export default async function TeacherPayrollPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  await requireRole(["superadmin", "admin"]);
  const sp = await searchParams;

  const now = new Date();
  const focus = sp.month ? new Date(sp.month + "-01T00:00:00Z") : now;
  const monthStr = focus.toISOString().slice(0, 7);
  const [rows, closeRates] = await Promise.all([
    getAllEarningsForMonth(focus),
    getAllTeacherCloseRates(focus),
  ]);
  const closeRateMap = new Map(closeRates.map(cr => [cr.teacherId, cr]));
  const totalCents = rows.reduce((s, r) => s + r.amount_cents, 0);
  const totalBonusCents = closeRates.reduce((s, cr) => s + cr.totalBonusCents, 0);
  const unpaidCents = rows.filter(r => !r.paid).reduce((s, r) => s + r.amount_cents, 0);

  return (
    <main className="space-y-5">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <Link href="/admin/finanzas" className="text-sm text-slate-500 dark:text-slate-400 hover:text-brand-600 dark:hover:text-brand-400">
            ← Volver a finanzas
          </Link>
          <h1 className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-50">
            Nómina <span className="capitalize font-normal text-slate-600 dark:text-slate-400">· {formatMonthEs(focus.toISOString())}</span>
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Total del mes: <strong>{moneyFromCents(totalCents, rows[0]?.currency ?? "EUR")}</strong> ·
            {" "}Pendiente de pagar: <strong className="text-amber-700 dark:text-amber-300">{moneyFromCents(unpaidCents, rows[0]?.currency ?? "EUR")}</strong>
            {totalBonusCents > 0 && (
              <> · Bonos desempeño: <strong className="text-emerald-700 dark:text-emerald-300">{moneyFromCents(totalBonusCents, "EUR")}</strong></>
            )}
          </p>
        </div>
        <PayrollMonthPicker currentMonth={monthStr} />
      </header>

      {/* Close rates & performance bonuses */}
      {closeRates.length > 0 && (
        <section className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
            Tasa de cierre · Clases de prueba
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="px-2 py-1 font-medium">Profesor</th>
                  <th className="px-2 py-1 font-medium text-center">Trials</th>
                  <th className="px-2 py-1 font-medium text-center">Ventas</th>
                  <th className="px-2 py-1 font-medium text-center">Tasa</th>
                  <th className="px-2 py-1 font-medium text-right">Bono/venta</th>
                  <th className="px-2 py-1 font-medium text-right">Bono total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {closeRates.map(cr => {
                  const teacher = rows.find(r => r.teacher_id === cr.teacherId);
                  return (
                    <tr key={cr.teacherId}>
                      <td className="px-2 py-1.5 font-medium text-slate-900 dark:text-slate-100">
                        {teacher?.teacher_name ?? cr.teacherId.slice(0, 8)}
                      </td>
                      <td className="px-2 py-1.5 text-center">{cr.trialsAttended}</td>
                      <td className="px-2 py-1.5 text-center">{cr.conversions}</td>
                      <td className="px-2 py-1.5 text-center">
                        <CloseRateBadge rate={cr.closeRate} />
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono">
                        {cr.bonusCentsPerSale > 0 ? moneyFromCents(cr.bonusCentsPerSale, "EUR") : "—"}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono font-semibold">
                        {cr.totalBonusCents > 0 ? moneyFromCents(cr.totalBonusCents, "EUR") : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Mobile: card grid. Desktop: full table. Both fed by the same rows. */}
      <section className="sm:hidden space-y-3">
        {rows.length === 0 && (
          <div className="rounded-3xl border border-dashed border-slate-200 dark:border-slate-700 p-8 text-center text-slate-500 dark:text-slate-400 text-sm">
            Sin horas registradas este mes.
          </div>
        )}
        {rows.map(r => {
          const monthStr = focus.toISOString().slice(0, 7);
          return (
            <article key={r.id ?? r.teacher_id} className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 space-y-3">
              <header className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-50 truncate">{r.teacher_name ?? "—"}</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{r.teacher_email}</p>
                </div>
                {r.paid ? (
                  <span className="shrink-0 inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-300 text-[11px] font-medium">
                    <span className="h-2 w-2 rounded-full bg-emerald-500" />
                    Pagado
                  </span>
                ) : (
                  <span className="shrink-0 inline-flex items-center gap-1.5 text-amber-700 dark:text-amber-300 text-[11px] font-medium">
                    <span className="h-2 w-2 rounded-full bg-amber-500" />
                    Pendiente
                  </span>
                )}
              </header>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div>
                  <div className="text-slate-500 dark:text-slate-400">Clases</div>
                  <div className="font-semibold text-slate-900 dark:text-slate-50 text-sm">{r.classes_count}</div>
                </div>
                <div>
                  <div className="text-slate-500 dark:text-slate-400">Horas</div>
                  <div className="font-semibold text-slate-900 dark:text-slate-50 text-sm">{(r.total_minutes / 60).toFixed(1)}</div>
                </div>
                <div>
                  <div className="text-slate-500 dark:text-slate-400">Ganancia</div>
                  <div className="font-semibold text-slate-900 dark:text-slate-50 text-sm font-mono">{moneyFromCents(r.amount_cents, r.currency)}</div>
                </div>
              </div>
              <div className="flex items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                {r.id && <PayToggle earningsId={r.id} paid={r.paid} />}
                <a
                  href={`/api/admin/finanzas/profesores/${r.teacher_id}/invoice/${monthStr}`}
                  target="_blank"
                  rel="noopener"
                  className="text-xs font-medium rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 px-3 py-1 ml-auto"
                >
                  PDF ↓
                </a>
              </div>
            </article>
          );
        })}
      </section>

      <section className="hidden sm:block rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800/60 text-left text-slate-600 dark:text-slate-300 text-xs">
            <tr>
              <Th>Profesor</Th>
              <Th>Correo</Th>
              <Th>Clases</Th>
              <Th>Horas</Th>
              <Th>Ganancia</Th>
              <Th>Estado</Th>
              <Th>Acción</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-800 dark:text-slate-200">
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="p-8 text-center text-slate-500 dark:text-slate-400">
                  Sin horas registradas este mes.
                </td>
              </tr>
            )}
            {rows.map(r => {
              const monthStr = focus.toISOString().slice(0, 7);
              return (
                <tr key={r.id ?? r.teacher_id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                  <Td className="font-medium">{r.teacher_name ?? "—"}</Td>
                  <Td><code className="text-xs">{r.teacher_email}</code></Td>
                  <Td>{r.classes_count}</Td>
                  <Td>{(r.total_minutes / 60).toFixed(1)} h</Td>
                  <Td className="font-mono">{moneyFromCents(r.amount_cents, r.currency)}</Td>
                  <Td>
                    {r.paid ? (
                      <span className="inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-300 text-xs">
                        <span className="h-2 w-2 rounded-full bg-emerald-500" />
                        Pagado {r.paid_at ? new Date(r.paid_at).toLocaleDateString("es-ES") : ""}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-amber-700 dark:text-amber-300 text-xs">
                        <span className="h-2 w-2 rounded-full bg-amber-500" />
                        Pendiente
                      </span>
                    )}
                  </Td>
                  <Td>
                    <div className="flex items-center gap-2">
                      {r.id && <PayToggle earningsId={r.id} paid={r.paid} />}
                      <a
                        href={`/api/admin/finanzas/profesores/${r.teacher_id}/invoice/${monthStr}`}
                        target="_blank"
                        rel="noopener"
                        className="text-xs font-medium rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 px-3 py-1"
                      >
                        PDF ↓
                      </a>
                    </div>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </main>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-2 font-medium whitespace-nowrap">{children}</th>;
}
function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 whitespace-nowrap ${className}`}>{children}</td>;
}

function CloseRateBadge({ rate }: { rate: number }) {
  const pct = rate.toFixed(0) + "%";
  if (rate >= 40) {
    return <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/10 rounded-full px-2 py-0.5">{pct} &#11088;</span>;
  }
  if (rate >= 30) {
    return <span className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-500/10 rounded-full px-2 py-0.5">{pct}</span>;
  }
  return <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">{pct}</span>;
}
