import Link from "next/link";
import { requireRoleWithImpersonation } from "@/lib/rbac";
import { redirect } from "next/navigation";
import { getCloserUrgentes, searchLeadsForCloser } from "@/lib/closer-urgentes";
import { LEAD_STATUS_LABEL } from "@/lib/setter-search";
import { CloserUrgentesTabs } from "@/components/closer/CloserUrgentesTabs";

export const metadata = { title: "Urgentes · Closer" };
export const dynamic = "force-dynamic";

/**
 * /closer/urgentes — CRM Closer F2 (Gelfis 2026-11-25).
 * Cola de cierre con 3 pestañas: post-trial sin cierre (desde 24h del
 * trial, ordenada por bono restante), no-shows y antiguos asignados a
 * mano. Los leads del funnel /sesion-plan siguen en "Mis leads".
 */
export default async function CloserUrgentesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const session = await requireRoleWithImpersonation(["closer", "admin", "superadmin"], "closer");
  if (session.user.role !== "closer") redirect("/admin");

  const { q } = await searchParams;
  const query = (q ?? "").trim();
  const [data, results] = await Promise.all([
    getCloserUrgentes(session.user.id),
    query.length >= 2 ? searchLeadsForCloser(session.user.id, query) : Promise.resolve(null),
  ]);
  const total = data.bono.length + data.postTrial.length + data.noShows.length + data.antiguos.length + data.seguimiento.length;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 space-y-5">
      <header>
        <h1 className="text-xl font-bold text-slate-900 dark:text-slate-50">Urgentes</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          {total === 0
            ? "Sin cierres pendientes ahora mismo."
            : `${total} lead${total === 1 ? "" : "s"} por trabajar. El bono del lead vence a las 48h de su clase de prueba.`}
          {data.ocultosSeguimiento > 0 &&
            ` ${data.ocultosSeguimiento} más en seguimiento pactado — reaparecen en su fecha.`}
        </p>
      </header>

      {/* Buscador (Gelfis 2026-11-27): nombre, apellido, email o número
          (subcadena de dígitos) entre TODOS sus leads. GET simple. */}
      <form method="GET" className="flex gap-2">
        <input
          type="search"
          name="q"
          defaultValue={query}
          placeholder="Buscar por nombre, email o número…"
          aria-label="Buscar lead"
          className="flex-1 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-4 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-400"
        />
        <button type="submit" className="btn-primary text-sm">Buscar</button>
        {query && (
          <Link href="/closer/urgentes" className="self-center text-sm text-slate-500 hover:text-brand-600">
            Limpiar
          </Link>
        )}
      </form>

      {results !== null && (
        <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          <p className="px-4 py-2.5 text-xs text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-slate-800">
            {results.length === 0
              ? `Sin resultados para “${query}” entre tus leads.`
              : `${results.length} resultado${results.length === 1 ? "" : "s"} para “${query}”`}
          </p>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {results.map((r) => (
              <li key={r.leadId}>
                <Link
                  href={`/closer/leads/${r.leadId}`}
                  className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-800/60"
                >
                  <div className="min-w-0">
                    <span className="text-sm font-medium text-slate-900 dark:text-slate-100">{r.name ?? "(sin nombre)"}</span>
                    <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                      {[r.phone, r.email].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-slate-500 dark:text-slate-400">
                    {LEAD_STATUS_LABEL[r.status] ?? r.status}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <CloserUrgentesTabs data={data} />
    </div>
  );
}
