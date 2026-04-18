import Link from "next/link";
import { requireRole } from "@/lib/rbac";
import { computeRiskAlerts, getStudentsAttendance } from "@/lib/reports";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reportes · Admin" };

const RANGES: Array<{ label: string; days: number }> = [
  { label: "30 días",  days: 30  },
  { label: "90 días",  days: 90  },
  { label: "365 días", days: 365 },
];

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  await requireRole(["superadmin", "admin"]);
  const sp = await searchParams;
  const days = Number(sp.days ?? 30);
  const activeDays = RANGES.some(r => r.days === days) ? days : 30;

  const [attendance, alerts] = await Promise.all([
    getStudentsAttendance(activeDays),
    computeRiskAlerts(),
  ]);

  const flagged = attendance.filter(a => a.total >= 3 && a.attendance_pct < 70);

  return (
    <main className="space-y-5">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Reportes</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Asistencia por estudiante y alertas de riesgo.
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          {RANGES.map(r => (
            <Link
              key={r.days}
              href={`/admin/reportes?days=${r.days}`}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors
                ${activeDays === r.days
                  ? "bg-brand-500 text-white"
                  : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"}`}
            >
              {r.label}
            </Link>
          ))}
        </div>
      </header>

      {alerts.length > 0 && (
        <section className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-red-700 dark:text-red-300">
            🚨 Alertas de riesgo ({alerts.length})
          </h2>
          <ul className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
            {alerts.map((a, i) => (
              <li key={i} className="py-3 flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
                    {a.subject}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    {a.detail}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <SeverityPill severity={a.severity} />
                  {a.link && (
                    <Link href={a.link} className="text-xs text-brand-600 dark:text-brand-400 hover:underline">
                      Ver →
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="px-5 pt-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
            Asistencia · últimos {activeDays} días
          </h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Se excluyen las clases aún no marcadas por el profesor. {flagged.length} estudiante(s) por debajo del 70%.
          </p>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-slate-600 dark:text-slate-300 text-xs">
              <tr>
                <Th>Estudiante</Th>
                <Th>Nivel</Th>
                <Th>Asistencia</Th>
                <Th>Asistió</Th>
                <Th>Faltó</Th>
                <Th>Pendientes</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-800 dark:text-slate-200">
              {attendance.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-slate-500 dark:text-slate-400">
                    Sin clases marcadas en este periodo.
                  </td>
                </tr>
              )}
              {attendance.map(a => (
                <tr key={a.student_id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                  <Td>
                    <Link href={`/admin/estudiantes/${a.student_id}`} className="font-medium text-slate-900 dark:text-slate-100 hover:text-brand-600 dark:hover:text-brand-400">
                      {a.student_name ?? a.student_email}
                    </Link>
                  </Td>
                  <Td>{a.level}</Td>
                  <Td>
                    <AttendanceBar pct={a.attendance_pct} />
                  </Td>
                  <Td className="text-emerald-700 dark:text-emerald-300">{a.attended}</Td>
                  <Td className="text-red-700 dark:text-red-400">{a.missed}</Td>
                  <Td className="text-slate-500 dark:text-slate-400">{a.pending}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

function SeverityPill({ severity }: { severity: "warn" | "danger" }) {
  const cls = severity === "danger"
    ? "bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 border-red-200 dark:border-red-500/30"
    : "bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-500/30";
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${cls}`}>
      {severity === "danger" ? "Crítica" : "Atención"}
    </span>
  );
}

function AttendanceBar({ pct }: { pct: number }) {
  const color = pct >= 90 ? "bg-emerald-500" : pct >= 70 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2 min-w-[120px]">
      <div className="flex-1 h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: `${Math.max(3, pct)}%` }} />
      </div>
      <span className="text-xs font-mono text-slate-700 dark:text-slate-300 w-10 text-right">{pct}%</span>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-2 font-medium whitespace-nowrap">{children}</th>;
}
function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 whitespace-nowrap ${className}`}>{children}</td>;
}
