import Link from "next/link";
import { redirect } from "next/navigation";
import { requireRoleWithImpersonation } from "@/lib/rbac";
import { getSetterAtendidos, ESTADO_LABEL, type AtendidoEstado } from "@/lib/setter-atendidos";
import { formatBerlinShort } from "@/lib/time";

export const metadata = { title: "Atendidos · Setter" };
export const dynamic = "force-dynamic";

const CHIPS: Array<{ key: string; label: string }> = [
  { key: "", label: "Todos" },
  { key: "respondio", label: "💬 Respondieron" },
  { key: "confirmado", label: "✅ Confirmados" },
  { key: "no_contesto", label: "📵 No contestó" },
  { key: "enlace_enviado", label: "🔗 Enlace enviado" },
  { key: "reagendo", label: "📅 Reagendó" },
  { key: "asistio", label: "🎓 Asistió" },
  { key: "descartado", label: "❌ Descartados" },
];

const ESTADO_BADGE: Record<AtendidoEstado, string> = {
  respondio: "bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300",
  confirmado: "bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  no_contesto: "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300",
  enlace_enviado: "bg-sky-100 dark:bg-sky-500/15 text-sky-700 dark:text-sky-300",
  reagendo: "bg-violet-100 dark:bg-violet-500/15 text-violet-700 dark:text-violet-300",
  asistio: "bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  descartado: "bg-red-100 dark:bg-red-500/15 text-red-700 dark:text-red-300",
  contactado: "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300",
};

export default async function SetterAtendidosPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; estado?: string }>;
}) {
  const session = await requireRoleWithImpersonation(["setter", "admin", "superadmin"], "setter");
  if (session.user.role !== "setter") redirect("/admin/setters");

  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const estado = sp.estado ?? "";

  const rows = await getSetterAtendidos(session.user.id, { q, estado });
  const respondieron = rows.filter(r => r.estado === "respondio").length;

  const chipHref = (key: string) =>
    `/setter/atendidos?${new URLSearchParams({ ...(q ? { q } : {}), ...(key ? { estado: key } : {}) }).toString()}`;

  return (
    <main className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Atendidos</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Todos los leads que ya contactaste. Los que respondieron después de tu último toque salen arriba — atiéndelos primero.
        </p>
      </header>

      <form method="GET" action="/setter/atendidos" className="flex flex-wrap gap-2">
        {estado && <input type="hidden" name="estado" value={estado} />}
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Buscar por nombre o número…"
          className="input-text w-full sm:w-80"
        />
        <button type="submit" className="btn-primary text-sm">Buscar</button>
        {q && (
          <Link href={chipHref(estado)} className="text-sm text-slate-500 hover:text-brand-600 self-center">
            Limpiar
          </Link>
        )}
      </form>

      <div className="flex flex-wrap gap-2">
        {CHIPS.map((c) => (
          <Link
            key={c.key}
            href={chipHref(c.key)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium border transition-colors ${
              estado === c.key
                ? "bg-brand-600 border-brand-600 text-white"
                : "border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-brand-400"
            }`}
          >
            {c.label}
            {c.key === "respondio" && respondieron > 0 && estado !== "respondio" && (
              <span className="ml-1 font-bold">({respondieron})</span>
            )}
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-slate-400 dark:text-slate-500">
          {q || estado ? "Sin resultados con ese filtro." : "Aún no has contactado a ningún lead."}
        </p>
      ) : (
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
              <span className={`text-xs rounded-full px-2 py-0.5 font-medium ${ESTADO_BADGE[r.estado]}`}>
                {ESTADO_LABEL[r.estado]}
              </span>
              {r.phone && (
                <span className="text-sm text-slate-500 dark:text-slate-400 font-mono">{r.phone}</span>
              )}
              {r.citaFutura && (
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  cita: {formatBerlinShort(r.citaFutura)}
                </span>
              )}
              <span className="ml-auto text-xs text-slate-400">
                {r.estado === "respondio" && r.respondioAt
                  ? `Respondió: ${formatBerlinShort(r.respondioAt)}`
                  : `Último toque: ${formatBerlinShort(r.lastActionAt)}`}
                {" · "}{r.contactos} contacto{r.contactos !== 1 ? "s" : ""}
              </span>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
