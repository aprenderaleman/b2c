import Link from "next/link";
import { requireRole } from "@/lib/rbac";
import { formatMonthEs, getAllEarningsForMonth, moneyFromCents } from "@/lib/finance";
import { PayToggle } from "./PayToggle";

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
  const rows = await getAllEarningsForMonth(focus);
  const totalCents = rows.reduce((s, r) => s + r.amount_cents, 0);
  const unpaidCents = rows.filter(r => !r.paid).reduce((s, r) => s + r.amount_cents, 0);

  return (
    <main className="space-y-5">
      <header>
        <Link href="/admin/finanzas" className="text-sm text-slate-500 dark:text-slate-400 hover:text-brand-600 dark:hover:text-brand-400">
          ← Volver a finanzas
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-50">
          Nómina <span className="capitalize font-normal text-slate-600 dark:text-slate-400">· {formatMonthEs(focus.toISOString())}</span>
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Total del mes: <strong>{moneyFromCents(totalCents, rows[0]?.currency ?? "EUR")}</strong> ·
          {" "}Pendiente de pagar: <strong className="text-amber-700 dark:text-amber-300">{moneyFromCents(unpaidCents, rows[0]?.currency ?? "EUR")}</strong>
        </p>
      </header>

      <section className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden">
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
