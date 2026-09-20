import Link from "next/link";
import { getTeachers, getTeacherStudents } from "@/lib/academy";

export const dynamic = "force-dynamic";
export const metadata = { title: "Profesores · Admin" };

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function TeachersListPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const vista: "activos" | "todos" = sp.vista === "todos" ? "todos" : "activos";

  const [rows, byTeacher] = await Promise.all([getTeachers(), getTeacherStudents()]);

  const totalActivos = new Set(Object.values(byTeacher).flat().filter(s => s.active).map(s => s.student_id)).size;
  const totalTodos   = new Set(Object.values(byTeacher).flat().map(s => s.student_id)).size;

  return (
    <main className="space-y-5">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Profesores</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {rows.length.toLocaleString("es-ES")} profesor{rows.length === 1 ? "" : "es"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/admin/profesores/invitar"
            className="text-sm rounded-lg border border-brand-300 dark:border-brand-500/40 bg-brand-50 dark:bg-brand-500/10 px-3 py-1.5 text-brand-700 dark:text-brand-200 hover:bg-brand-100 dark:hover:bg-brand-500/20"
          >
            ✉ Invitar profesor
          </Link>
          <Link href="/admin/profesores/nuevo" className="btn-primary text-sm">
            + Añadir profesor
          </Link>
        </div>
      </header>

      <div className="inline-flex rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-1 text-sm">
        <Tab href="/admin/profesores" active={vista === "activos"}>
          Estudiantes activos <Count n={totalActivos} />
        </Tab>
        <Tab href="/admin/profesores?vista=todos" active={vista === "todos"}>
          Todos los estudiantes <Count n={totalTodos} />
        </Tab>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800/60 text-left text-slate-600 dark:text-slate-300">
            <tr>
              <Th>Nombre</Th>
              <Th>Estado</Th>
              <Th>Tarifa</Th>
              <Th>{vista === "activos" ? "Estudiantes activos" : "Todos los estudiantes"}</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-800 dark:text-slate-200">
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="p-8 text-center text-slate-500 dark:text-slate-400">
                  Aún no hay profesores. Crea el primero con el botón de arriba.
                </td>
              </tr>
            )}
            {rows.map(t => {
              const all = byTeacher[t.id] ?? [];
              const list = vista === "activos" ? all.filter(s => s.active) : all;
              const nActivos = all.filter(s => s.active).length;
              return (
                <tr key={t.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40 align-top">
                  <Td>
                    <Link href={`/admin/profesores/${t.id}`} className="font-medium text-slate-900 dark:text-slate-100 hover:text-brand-600 dark:hover:text-brand-400">
                      {t.full_name || "—"}
                    </Link>
                    <div className="text-xs text-slate-400"><code>{t.email}</code></div>
                  </Td>
                  <Td>
                    <span className="inline-flex items-center gap-1.5">
                      <span className={`h-2 w-2 rounded-full ${t.active ? "bg-emerald-500" : "bg-slate-400"}`} aria-hidden />
                      <span className="text-xs">{t.active ? "Activo" : "Inactivo"}</span>
                    </span>
                  </Td>
                  <Td>
                    {t.hourly_rate
                      ? `${Number(t.hourly_rate).toFixed(2)} ${t.currency}/h`
                      : <span className="text-slate-400">—</span>}
                  </Td>
                  <td className="px-3 py-2">
                    <div className="text-xs text-slate-500 dark:text-slate-400 mb-1 tabular-nums">
                      {nActivos} activo{nActivos === 1 ? "" : "s"} · {all.length} en total
                    </div>
                    {list.length === 0 ? (
                      <span className="text-slate-400">—</span>
                    ) : (
                      <div className="flex flex-wrap gap-1.5 max-w-xl">
                        {list.map(s => (
                          <Link
                            key={s.student_id}
                            href={`/admin/estudiantes/${s.student_id}`}
                            className={`rounded-full border px-2 py-0.5 text-xs hover:border-brand-400 ${
                              s.active
                                ? "border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-200"
                                : "border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400"
                            }`}
                          >
                            {s.full_name || "—"}
                          </Link>
                        ))}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </main>
  );
}

function Tab({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={`rounded-lg px-3 py-1.5 font-medium ${
        active
          ? "bg-brand-500 text-white"
          : "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
      }`}
    >
      {children}
    </Link>
  );
}
function Count({ n }: { n: number }) {
  return <span className="ml-1 tabular-nums opacity-80">({n})</span>;
}
function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-2 font-medium whitespace-nowrap">{children}</th>;
}
function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-3 py-2 whitespace-nowrap">{children}</td>;
}
