import Link from "next/link";
import { getTeachers, getTeacherStudents } from "@/lib/academy";
import { listInvitations, invitationStatus } from "@/lib/teacher-invitations";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const metadata = { title: "Profesores · Admin" };

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function TeachersListPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const vista: "activos" | "todos" = sp.vista === "todos" ? "todos" : "activos";

  const [rows, byTeacher, invitations, approvalRes] = await Promise.all([
    getTeachers(),
    getTeacherStudents(),
    listInvitations(),
    supabaseAdmin().from("teachers").select("id, approved_at"),
  ]);

  // Invitaciones aún sin completar (Gelfis 2026-11-27: "no veo a los
  // invitados"): pendientes de registro + expiradas sin usar. Las
  // completadas ya aparecen como profes en la tabla.
  const openInvitations = invitations
    .map(inv => ({ inv, status: invitationStatus(inv) }))
    .filter(x => x.status === "pendiente" || x.status === "expirada");

  const approvedByTeacher = new Map<string, string | null>(
    ((approvalRes.data ?? []) as Array<{ id: string; approved_at: string | null }>)
      .map(t => [t.id, t.approved_at]),
  );

  // Vista "activos" (default): solo profes activos (Gelfis 2026-10-26).
  // La pestaña "Todos" sigue enseñando también a los desactivados.
  const teachers = vista === "activos" ? rows.filter(t => t.active) : rows;

  const totalActivos = new Set(Object.values(byTeacher).flat().filter(s => s.active).map(s => s.student_id)).size;
  const totalTodos   = new Set(Object.values(byTeacher).flat().map(s => s.student_id)).size;

  return (
    <main className="space-y-5">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Profesores</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {teachers.length.toLocaleString("es-ES")} profesor{teachers.length === 1 ? "" : "es"}
            {vista === "activos" && rows.length > teachers.length ? ` (${rows.length - teachers.length} inactivos ocultos)` : ""}
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

      {openInvitations.length > 0 && (
        <section className="rounded-2xl border border-amber-200 dark:border-amber-500/30 bg-amber-50/60 dark:bg-amber-500/10 p-4">
          <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
            <h2 className="text-sm font-bold text-amber-800 dark:text-amber-200">
              ✉ Invitaciones sin completar ({openInvitations.length})
            </h2>
            <Link href="/admin/profesores/invitar" className="text-xs text-amber-700 dark:text-amber-300 underline underline-offset-2 hover:opacity-80">
              Gestionar (reenviar / revocar) →
            </Link>
          </div>
          <ul className="space-y-1.5">
            {openInvitations.map(({ inv, status }) => (
              <li key={inv.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <span className="font-medium text-slate-900 dark:text-slate-100">{inv.name ?? "—"}</span>
                <code className="text-xs text-slate-500 dark:text-slate-400">{inv.email}</code>
                {inv.rate_individual_eur != null && (
                  <span className="text-xs text-slate-500 dark:text-slate-400">{Number(inv.rate_individual_eur).toFixed(0)} €/h</span>
                )}
                {status === "pendiente" ? (
                  <span className="text-xs rounded-full px-2 py-0.5 bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-200 font-medium">
                    ⏳ Esperando registro · enviada el {fmtFecha(inv.last_sent_at ?? inv.created_at)} · caduca el {fmtFecha(inv.expires_at)}
                  </span>
                ) : (
                  <span className="text-xs rounded-full px-2 py-0.5 bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300 font-medium">
                    ⌛ Expiró el {fmtFecha(inv.expires_at)} sin registrarse — reenvíala si sigue en pie
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="inline-flex rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-1 text-sm">
        <Tab href="/admin/profesores" active={vista === "activos"}>
          Activos <Count n={totalActivos} />
        </Tab>
        <Tab href="/admin/profesores?vista=todos" active={vista === "todos"}>
          Todos <Count n={totalTodos} />
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
            {teachers.length === 0 && (
              <tr>
                <td colSpan={4} className="p-8 text-center text-slate-500 dark:text-slate-400">
                  Aún no hay profesores. Crea el primero con el botón de arriba.
                </td>
              </tr>
            )}
            {teachers.map(t => {
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
                    {/* Registrado pero sin aprobar (Gelfis 2026-11-27). */}
                    {!approvedByTeacher.get(t.id) && (
                      <div className="mt-1">
                        <span className="text-[11px] rounded-full px-2 py-0.5 bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-200 font-medium">
                          ⏳ Por aprobar
                        </span>
                      </div>
                    )}
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

function fmtFecha(iso: string): string {
  return new Date(iso).toLocaleDateString("es-ES", {
    day: "numeric", month: "short", timeZone: "Europe/Berlin",
  });
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
