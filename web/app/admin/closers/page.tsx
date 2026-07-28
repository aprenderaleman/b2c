import Link from "next/link";
import { requireRole } from "@/lib/rbac";
import { supabaseAdmin } from "@/lib/supabase";

export const metadata = { title: "Closers · Admin" };

export default async function ClosersPage() {
  await requireRole(["superadmin", "admin"]);

  const sb = supabaseAdmin();
  const { data: closers } = await sb
    .from("users")
    .select("id, email, full_name, phone, active, rango, created_at")
    .eq("role", "closer")
    .order("created_at", { ascending: false });

  const closerList = (closers ?? []) as Array<{
    id: string;
    email: string;
    full_name: string | null;
    phone: string | null;
    active: boolean;
    rango: string | null;
    created_at: string;
  }>;

  // Get lead counts per closer
  const closerIds = closerList.map((c) => c.id);
  let leadCounts: Record<string, number> = {};
  if (closerIds.length > 0) {
    const { data: leads } = await sb
      .from("leads")
      .select("closer_id")
      .in("closer_id", closerIds);
    for (const l of (leads ?? []) as Array<{ closer_id: string }>) {
      leadCounts[l.closer_id] = (leadCounts[l.closer_id] ?? 0) + 1;
    }
  }

  return (
    <main className="space-y-5">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Closers</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {closerList.length} closer{closerList.length !== 1 ? "s" : ""} registrado{closerList.length !== 1 ? "s" : ""}
          </p>
        </div>
        <Link
          href="/admin/closers/nuevo"
          className="btn-primary text-sm"
        >
          Nuevo closer
        </Link>
      </header>

      <div className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-left text-xs text-slate-600 dark:text-slate-300">
              <tr>
                <th className="px-4 py-3 font-medium">Nombre</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Rango</th>
                <th className="px-4 py-3 font-medium text-right">Leads</th>
                <th className="px-4 py-3 font-medium">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {closerList.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                  <td className="px-4 py-3 font-medium text-slate-800 dark:text-slate-200">
                    {c.full_name ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{c.email}</td>
                  <td className="px-4 py-3 capitalize text-slate-600 dark:text-slate-300">
                    {c.rango ?? "rookie"}
                  </td>
                  <td className="px-4 py-3 text-right">{leadCounts[c.id] ?? 0}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                      c.active
                        ? "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30"
                        : "bg-slate-50 dark:bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-500/30"
                    }`}>
                      {c.active ? "Activo" : "Inactivo"}
                    </span>
                  </td>
                </tr>
              ))}
              {closerList.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-400 text-sm">
                    No hay closers. Crea el primero.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
