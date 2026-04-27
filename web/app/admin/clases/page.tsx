import Link from "next/link";
import { getClassesInRange, type ClassWithPeople, formatClassDateEs, formatClassTimeEs, classStatusEs } from "@/lib/classes";
import { ClassesPageClient } from "./ClassesPageClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Clases · Admin" };

export default async function ClassesListPage() {
  // Load 60 days worth of upcoming classes + last 30 days of history.
  const now  = new Date();
  const from = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
  const to   = new Date(now.getTime() + 60 * 24 * 3600 * 1000);

  const classes = await getClassesInRange(from, to);
  const { upcoming, past } = partition(classes, now);

  return (
    <main className="space-y-5">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Clases</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {upcoming.length} próxima{upcoming.length === 1 ? "" : "s"} · {past.length} pasada{past.length === 1 ? "" : "s"} (últimos 30 días)
          </p>
        </div>
        <ClassesPageClient />
      </header>

      <aside className="rounded-2xl border border-brand-200 dark:border-brand-500/30 bg-brand-50/60 dark:bg-brand-500/5 px-4 py-3 text-xs text-slate-700 dark:text-slate-200">
        <p className="font-semibold text-brand-700 dark:text-brand-300 mb-1">📅 ¿Clase recurrente o suelta?</p>
        <p>
          Si es una serie de clases para un grupo (ej. "Deutsch A1-B1
          Abends, martes y jueves"), créala desde{" "}
          <Link href="/admin/grupos" className="underline underline-offset-2 hover:text-brand-700 dark:hover:text-brand-300">/admin/grupos → Nuevo grupo</Link>.
          El wizard te deja definir miembros y agendar todas las
          sesiones de un tirón.
        </p>
        <p className="mt-1.5 text-slate-500 dark:text-slate-400">
          Esta página es para casos puntuales: clases de recuperación,
          sustituciones, sesiones extra para un solo estudiante, etc.
        </p>
      </aside>

      <section className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
          Próximas
        </h2>
        <ClassTable rows={upcoming} empty="No hay clases agendadas." />
      </section>

      <section className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
          Historial (últimos 30 días)
        </h2>
        <ClassTable rows={past} empty="Sin clases en los últimos 30 días." />
      </section>
    </main>
  );
}

function partition(rows: ClassWithPeople[], now: Date) {
  const upcoming: ClassWithPeople[] = [];
  const past:     ClassWithPeople[] = [];
  for (const r of rows) {
    if (new Date(r.scheduled_at).getTime() >= now.getTime()) upcoming.push(r);
    else past.unshift(r);   // newest first in past
  }
  return { upcoming, past };
}

function ClassTable({ rows, empty }: { rows: ClassWithPeople[]; empty: string }) {
  if (rows.length === 0) {
    return <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">{empty}</p>;
  }
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-slate-600 dark:text-slate-300 text-xs">
          <tr>
            <Th>Cuándo</Th>
            <Th>Duración</Th>
            <Th>Título</Th>
            <Th>Tipo</Th>
            <Th>Profesor</Th>
            <Th>Estudiantes</Th>
            <Th>Estado</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-800 dark:text-slate-200">
          {rows.map(c => (
            <tr key={c.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
              <Td>
                <Link href={`/admin/clases/${c.id}`} className="block">
                  <div className="font-medium capitalize">{formatClassDateEs(c.scheduled_at)}</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                    {formatClassTimeEs(c.scheduled_at)} (Berlín)
                  </div>
                </Link>
              </Td>
              <Td className="whitespace-nowrap">{c.duration_minutes} min</Td>
              <Td>
                <Link href={`/admin/clases/${c.id}`} className="font-medium text-slate-900 dark:text-slate-100 hover:text-brand-600 dark:hover:text-brand-400">
                  {c.title}
                </Link>
                {c.recurrence_pattern !== "none" && (
                  <span className="ml-2 text-[10px] uppercase tracking-wider text-brand-600 dark:text-brand-400">
                    {recurrenceLabel(c.recurrence_pattern)}
                  </span>
                )}
              </Td>
              <Td>{c.type === "individual" ? "Individual" : "Grupo"}</Td>
              <Td>{c.teacher_name ?? c.teacher_email}</Td>
              <Td>
                <span className="text-xs">
                  {c.participants.length === 1
                    ? (c.participants[0].student_name ?? c.participants[0].student_email)
                    : `${c.participants.length} estudiantes`}
                </span>
              </Td>
              <Td>
                <StatusPill status={c.status} />
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-2 font-medium whitespace-nowrap">{children}</th>;
}
function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 ${className}`}>{children}</td>;
}

function recurrenceLabel(p: string): string {
  return p === "weekly" ? "Semanal" : p === "biweekly" ? "Quincenal" : p === "monthly" ? "Mensual" : "";
}

function StatusPill({ status }: { status: string }) {
  const cls =
    status === "scheduled" ? "bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-500/30" :
    status === "live"      ? "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30" :
    status === "completed" ? "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700" :
    status === "cancelled" ? "bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 border-red-200 dark:border-red-500/30" :
                             "bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-500/30";
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${cls}`}>
      {classStatusEs(status as Parameters<typeof classStatusEs>[0])}
    </span>
  );
}
