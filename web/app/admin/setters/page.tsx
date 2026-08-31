import Link from "next/link";
import { requireRole } from "@/lib/rbac";
import { supabaseAdmin } from "@/lib/supabase";
import { ImpersonateButton } from "@/components/admin/ImpersonateButton";
import { getSetterMetrics } from "@/lib/setter-metrics";
import { SetterMetricsBoard } from "@/components/setter/SetterMetricsBoard";

export const metadata = { title: "Setters · Admin" };
export const dynamic = "force-dynamic";

const RANGES = [
  { days: 1, label: "Hoy" },
  { days: 7, label: "7 días" },
  { days: 30, label: "30 días" },
];

export default async function SettersPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  await requireRole(["superadmin", "admin"]);
  const sp = await searchParams;
  const days = Math.min(365, Math.max(1, parseInt(sp.days ?? "7", 10) || 7));

  const sb = supabaseAdmin();
  const { data: setters } = await sb
    .from("users")
    .select("id, email, full_name, phone, active, created_at")
    .eq("role", "setter")
    .order("created_at", { ascending: false });

  const setterList = (setters ?? []) as Array<{
    id: string;
    email: string;
    full_name: string | null;
    phone: string | null;
    active: boolean;
    created_at: string;
  }>;

  const metrics = await getSetterMetrics(days);

  return (
    <main className="space-y-5">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Setters</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {setterList.length} setter{setterList.length !== 1 ? "s" : ""} registrado{setterList.length !== 1 ? "s" : ""}
          </p>
        </div>
        <Link href="/admin/setters/nuevo" className="btn-primary text-sm">
          Nuevo setter
        </Link>
      </header>

      <div className="flex gap-2">
        {RANGES.map((r) => (
          <Link
            key={r.days}
            href={`/admin/setters?days=${r.days}`}
            className={`rounded-full px-3 py-1.5 text-xs font-medium border transition-colors ${
              days === r.days
                ? "bg-brand-600 border-brand-600 text-white"
                : "border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-brand-400"
            }`}
          >
            {r.label}
          </Link>
        ))}
      </div>

      <SetterMetricsBoard
        m={metrics}
        title={`Métricas globales (todos los setters) — últimos ${days === 1 ? "24h" : `${days} días`}`}
      />

      {setterList.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Aun no hay setters. Crea el primero con &quot;Nuevo setter&quot;.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                <th className="px-4 py-3">Nombre</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Telefono</th>
                <th className="px-4 py-3">Estado</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {setterList.map((s) => (
                <tr key={s.id} className="border-b border-slate-100 dark:border-slate-800 last:border-0">
                  <td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-100">
                    <Link href={`/admin/setters/${s.id}`} className="hover:text-brand-600 dark:hover:text-brand-400">
                      {s.full_name ?? "(sin nombre)"}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{s.email}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{s.phone ?? "—"}</td>
                  <td className="px-4 py-3">
                    {s.active ? (
                      <span className="inline-flex rounded-full bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 px-2 py-0.5 text-xs font-medium">Activo</span>
                    ) : (
                      <span className="inline-flex rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 px-2 py-0.5 text-xs font-medium">Inactivo</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                    <Link
                      href={`/admin/setters/${s.id}`}
                      className="inline-flex rounded-full border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:border-brand-400 hover:text-brand-600 dark:hover:text-brand-400"
                    >
                      Metricas
                    </Link>
                    {s.active && (
                      <ImpersonateButton userId={s.id} userName={s.full_name ?? s.email} role="setter" />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
