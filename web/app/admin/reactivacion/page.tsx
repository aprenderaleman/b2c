import { requireRole } from "@/lib/rbac";
import { supabaseAdmin } from "@/lib/supabase";
import { getSpeedToLead, getChainFunnel } from "@/lib/closer-metrics";
import { ReactivationPanel } from "./ReactivationPanel";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reactivacion · Admin" };

export default async function ReactivacionPage() {
  await requireRole(["superadmin", "admin"]);

  const sb = supabaseAdmin();
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86_400_000);

  const [closers, speedToLead, chainFunnel, pendingCount] = await Promise.all([
    sb
      .from("users")
      .select("id, full_name")
      .eq("role", "closer")
      .eq("active", true)
      .then(({ data }) => (data ?? []) as Array<{ id: string; full_name: string | null }>),
    getSpeedToLead(thirtyDaysAgo, now),
    getChainFunnel(thirtyDaysAgo, now),
    sb
      .from("leads")
      .select("id", { count: "exact", head: true })
      .in("estado_cierre", ["perdido", "en_reactivacion"])
      .is("converted_to_user_id", null)
      .is("reactivation_batch_id", null)
      .gte("created_at", new Date(now.getTime() - 90 * 86_400_000).toISOString())
      .then(({ count }) => count ?? 0),
  ]);

  return (
    <main className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">
        Reactivacion
      </h1>

      {/* Speed-to-lead KPIs */}
      <section className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
          Speed-to-lead (30d)
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <KpiCard label="Mediciones" value={speedToLead.count} />
          <KpiCard
            label="Promedio"
            value={fmtDuration(speedToLead.avg_minutes)}
          />
          <KpiCard
            label="Mediana"
            value={fmtDuration(speedToLead.median_minutes)}
          />
          <KpiCard
            label="P90"
            value={fmtDuration(speedToLead.p90_minutes)}
            warn={speedToLead.p90_minutes > 120}
          />
        </div>
      </section>

      {/* Chain funnel */}
      <section className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
            Funnel por cadena (30d)
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-left text-xs text-slate-600 dark:text-slate-300">
              <tr>
                <th className="px-4 py-2 font-medium">Cadena</th>
                <th className="px-4 py-2 font-medium text-right">Iniciadas</th>
                <th className="px-4 py-2 font-medium text-right">Activas</th>
                <th className="px-4 py-2 font-medium text-right">Convertidas</th>
                <th className="px-4 py-2 font-medium text-right">Canceladas</th>
                <th className="px-4 py-2 font-medium text-right">% Conv.</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {chainFunnel.map((entry) => (
                <tr key={entry.chain_type} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                  <td className="px-4 py-2 font-medium text-slate-800 dark:text-slate-200">
                    {entry.chain_type}
                  </td>
                  <td className="px-4 py-2 text-right">{entry.started}</td>
                  <td className="px-4 py-2 text-right">{entry.active}</td>
                  <td className="px-4 py-2 text-right text-emerald-600 dark:text-emerald-400 font-medium">
                    {entry.completed}
                  </td>
                  <td className="px-4 py-2 text-right text-slate-400">{entry.cancelled}</td>
                  <td className="px-4 py-2 text-right font-medium">
                    {entry.conversion_rate.toFixed(1)}%
                  </td>
                </tr>
              ))}
              {chainFunnel.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                    Sin datos de cadenas.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Reactivation trigger */}
      <ReactivationPanel closers={closers} pendingCount={pendingCount} />
    </main>
  );
}

function KpiCard({
  label,
  value,
  warn,
}: {
  label: string;
  value: string | number;
  warn?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
      <p className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wide">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${warn ? "text-amber-600 dark:text-amber-400" : "text-slate-900 dark:text-slate-50"}`}>
        {value}
      </p>
    </div>
  );
}

function fmtDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}
