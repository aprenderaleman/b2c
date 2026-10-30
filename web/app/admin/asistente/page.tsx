import Link from "next/link";
import { requireRole } from "@/lib/rbac";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const metadata = { title: "Asistente IA · Admin" };

type Row = {
  id: string; role: string; pregunta: string; respuesta: string | null; sin_resolver: string | null;
  acciones: Array<{ titulo?: string }>; created_at: string;
  users: { full_name: string | null; email: string } | Array<{ full_name: string | null; email: string }> | null;
};

const ROLE_ES: Record<string, string> = { student: "Estudiante", teacher: "Profesor", admin: "Admin" };

/** Uso del Asistente IA: qué se pregunta y qué no supo resolver (retención 90 días). */
export default async function AdminAsistentePage({ searchParams }: { searchParams: Promise<{ filtro?: string }> }) {
  await requireRole(["admin", "superadmin"]);
  const soloSinResolver = (await searchParams).filtro === "sin-resolver";

  const sb = supabaseAdmin();
  const since = new Date(Date.now() - 30 * 24 * 3600_000).toISOString();
  let q = sb
    .from("asistente_logs")
    .select("id, role, pregunta, respuesta, sin_resolver, acciones, created_at, users(full_name, email)")
    .order("created_at", { ascending: false })
    .limit(100);
  if (soloSinResolver) q = q.not("sin_resolver", "is", null);
  const [{ data }, { count: total }, { count: sinResolver }] = await Promise.all([
    q,
    sb.from("asistente_logs").select("id", { count: "exact", head: true }).gte("created_at", since),
    sb.from("asistente_logs").select("id", { count: "exact", head: true }).gte("created_at", since).not("sin_resolver", "is", null),
  ]);
  const rows = (data ?? []) as unknown as Row[];

  return (
    <main className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Asistente IA</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Últimos 30 días: {total ?? 0} consultas · {sinResolver ?? 0} sin resolver. Las conversaciones se borran a los 90 días.
        </p>
      </header>
      <nav className="flex gap-2 text-sm">
        <Link href="/admin/asistente" className={`rounded-xl px-3 py-1.5 border ${!soloSinResolver ? "border-brand-500 text-brand-600" : "border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300"}`}>Todas</Link>
        <Link href="/admin/asistente?filtro=sin-resolver" className={`rounded-xl px-3 py-1.5 border ${soloSinResolver ? "border-brand-500 text-brand-600" : "border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300"}`}>Sin resolver</Link>
      </nav>
      {rows.length === 0 && <p className="text-sm text-slate-500 dark:text-slate-400">Aún no hay consultas.</p>}
      <ul className="space-y-3">
        {rows.map(r => {
          const u = Array.isArray(r.users) ? r.users[0] : r.users;
          return (
            <li key={r.id} className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                <span className="font-semibold text-slate-700 dark:text-slate-200">{u?.full_name ?? u?.email ?? "—"}</span>
                <span>{ROLE_ES[r.role] ?? r.role}</span>
                <span>{new Date(r.created_at).toLocaleString("es-ES", { timeZone: "Europe/Berlin", dateStyle: "short", timeStyle: "short" })}</span>
                {r.acciones.length > 0 && <span className="text-brand-600 dark:text-brand-400">{r.acciones.length} tarjeta{r.acciones.length === 1 ? "" : "s"}</span>}
              </div>
              <p className="mt-2 text-sm font-medium text-slate-900 dark:text-slate-50 whitespace-pre-wrap">{r.pregunta}</p>
              {r.sin_resolver && (
                <p className="mt-2 rounded-xl bg-amber-50 dark:bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">Sin resolver: {r.sin_resolver}</p>
              )}
              {r.respuesta && (
                <details className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                  <summary className="cursor-pointer text-xs text-slate-500 dark:text-slate-400">Respuesta</summary>
                  <p className="mt-1 whitespace-pre-wrap">{r.respuesta}</p>
                </details>
              )}
            </li>
          );
        })}
      </ul>
    </main>
  );
}
