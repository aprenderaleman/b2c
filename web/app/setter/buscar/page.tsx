import Link from "next/link";
import { redirect } from "next/navigation";
import { requireRoleWithImpersonation } from "@/lib/rbac";
import { searchLeadsForSetter, LEAD_STATUS_LABEL } from "@/lib/setter-search";
import { formatBerlinShort } from "@/lib/time";

export const metadata = { title: "Buscar leads · Setter" };
export const dynamic = "force-dynamic";

/**
 * Buscador global de leads del setter (Gelfis 2026-11-10): todos los
 * leads del sistema, buscando por nombre, teléfono (parcial), email,
 * meta, motivo o nivel. Clic → ficha del lead.
 */
export default async function SetterBuscarPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const session = await requireRoleWithImpersonation(["setter", "admin", "superadmin"], "setter");
  if (session.user.role !== "setter") redirect("/admin/setters");

  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const rows = q.length >= 2 ? await searchLeadsForSetter(q) : [];

  return (
    <main className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Buscar leads</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Todos los leads del sistema. Busca por nombre, teléfono (vale una parte del número), email, meta o nivel.
        </p>
      </header>

      <form method="GET" action="/setter/buscar" className="flex flex-wrap gap-2">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Ej: María, 1675, gmail, work, B1…"
          className="input-text w-full sm:w-96"
          autoFocus
        />
        <button type="submit" className="btn-primary text-sm">Buscar</button>
      </form>

      {q.length > 0 && q.length < 2 && (
        <p className="text-sm text-slate-400">Escribe al menos 2 caracteres.</p>
      )}

      {q.length >= 2 && (
        rows.length === 0 ? (
          <p className="text-sm text-slate-400 dark:text-slate-500">Sin resultados para “{q}”.</p>
        ) : (
          <>
            <p className="text-xs text-slate-400">
              {rows.length === 50 ? "Mostrando los 50 más recientes — afina la búsqueda si no está el que buscas." : `${rows.length} resultado${rows.length !== 1 ? "s" : ""}.`}
            </p>
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 divide-y divide-slate-100 dark:divide-slate-800">
              {rows.map((r) => (
                <Link
                  key={r.leadId}
                  href={`/setter/leads/${r.leadId}`}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                >
                  <span className="font-medium text-slate-900 dark:text-slate-100 min-w-[8rem]">
                    {r.name ?? "(sin nombre)"}
                  </span>
                  <span className="text-xs rounded-full px-2 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                    {LEAD_STATUS_LABEL[r.status] ?? r.status}
                  </span>
                  {r.phone && (
                    <span className="text-sm text-slate-500 dark:text-slate-400 font-mono">{r.phone}</span>
                  )}
                  {r.email && (
                    <span className="text-sm text-slate-500 dark:text-slate-400 truncate max-w-[16rem]">{r.email}</span>
                  )}
                  {r.citaFutura && (
                    <span className="text-xs text-emerald-600 dark:text-emerald-400">
                      cita: {formatBerlinShort(r.citaFutura)}
                    </span>
                  )}
                  <span className="ml-auto text-xs text-slate-400">
                    alta: {formatBerlinShort(r.createdAt)}
                  </span>
                </Link>
              ))}
            </div>
          </>
        )
      )}
    </main>
  );
}
