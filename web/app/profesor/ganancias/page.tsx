import Link from "next/link";
import { requireRoleWithImpersonation } from "@/lib/rbac";
import { getTeacherByUserId } from "@/lib/academy";
import { formatMonthEs, getTeacherEarningsSummary, moneyFromCents } from "@/lib/finance";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mis ganancias · Profesor" };

export default async function TeacherEarningsPage() {
  const session = await requireRoleWithImpersonation(
    ["teacher", "admin", "superadmin"],
    "teacher",
  );
  const teacher = await getTeacherByUserId(session.user.id);

  if (!teacher) {
    return (
      <main>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Mis ganancias</h1>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          Tu cuenta no tiene un perfil de profesor asociado.
        </p>
      </main>
    );
  }

  const months = await getTeacherEarningsSummary(teacher.id, 12);
  const currentMonthStr = new Date().toISOString().slice(0, 7) + "-01";
  const current = months.find(m => m.month.startsWith(currentMonthStr.slice(0, 7))) ?? {
    amount_cents:  0, total_minutes: 0, classes_count: 0,
    currency:      teacher.currency, paid: false, paid_at: null,
    payment_reference: null, locked: false,
    id: null, teacher_id: teacher.id, month: currentMonthStr,
  };

  const previous = months.filter(m => !m.month.startsWith(currentMonthStr.slice(0, 7)));

  return (
    <main className="space-y-5">
      <header>
        <Link href="/profesor" className="text-sm text-slate-500 dark:text-slate-400 hover:text-brand-600 dark:hover:text-brand-400">
          ← Volver al inicio
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-50">Mis ganancias</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Se calcula automáticamente cuando confirmas la duración real de cada clase.
          Los pagos se hacen manualmente cada mes.
        </p>
      </header>

      <section className="grid gap-4 sm:grid-cols-3">
        <BigStat
          label="Este mes"
          value={moneyFromCents(current.amount_cents, current.currency)}
          sub={`${(current.total_minutes / 60).toFixed(1)} h · ${current.classes_count} clase${current.classes_count === 1 ? "" : "s"}`}
          accent
        />
        <BigStat
          label="Tarifa actual"
          value={teacher.hourly_rate ? `${Number(teacher.hourly_rate).toFixed(2)} ${teacher.currency}/h` : "—"}
          sub={teacher.hourly_rate ? "Según lo acordado con admin" : "Pide al admin que te configure tarifa"}
        />
        <BigStat
          label="Estado de pago"
          value={current.paid ? "Pagado ✓" : "Pendiente"}
          sub={current.paid && current.paid_at
            ? `Pagado el ${new Date(current.paid_at).toLocaleDateString("es-ES")}`
            : "Se cobra al cierre del mes"}
        />
      </section>

      <section className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
          Histórico ({previous.length})
        </h2>
        {previous.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
            Aún no hay meses cerrados. Este es tu primer mes.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-slate-600 dark:text-slate-300 text-xs">
                <tr>
                  <Th>Mes</Th>
                  <Th>Clases</Th>
                  <Th>Horas</Th>
                  <Th>Ganancia</Th>
                  <Th>Estado</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-800 dark:text-slate-200">
                {previous.map(m => (
                  <tr key={m.month}>
                    <Td className="capitalize font-medium">{formatMonthEs(m.month)}</Td>
                    <Td>{m.classes_count}</Td>
                    <Td>{(m.total_minutes / 60).toFixed(1)} h</Td>
                    <Td className="font-mono">{moneyFromCents(m.amount_cents, m.currency)}</Td>
                    <Td>
                      {m.paid ? (
                        <span className="inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-300 text-xs">
                          <span className="h-2 w-2 rounded-full bg-emerald-500" /> Pagado
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-amber-700 dark:text-amber-300 text-xs">
                          <span className="h-2 w-2 rounded-full bg-amber-500" /> Pendiente
                        </span>
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

function BigStat({ label, value, sub, accent }: {
  label: string; value: string; sub: string; accent?: boolean;
}) {
  return (
    <div className={`rounded-2xl border p-5 ${accent
      ? "bg-brand-50 dark:bg-brand-500/10 border-brand-200 dark:border-brand-500/30"
      : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800"}`}>
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</div>
      <div className={`mt-2 text-3xl font-bold ${accent ? "text-brand-700 dark:text-brand-300" : "text-slate-900 dark:text-slate-50"}`}>
        {value}
      </div>
      <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{sub}</div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-2 font-medium whitespace-nowrap">{children}</th>;
}
function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 whitespace-nowrap ${className}`}>{children}</td>;
}
