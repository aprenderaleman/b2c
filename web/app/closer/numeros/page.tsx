import { requireRole } from "@/lib/rbac";
import { getCloserStats } from "@/lib/closer-commissions";
import { getRankingTable } from "@/lib/ranking";
import { supabaseAdmin } from "@/lib/supabase";

export const metadata = { title: "Mis numeros · Closer" };

export default async function CloserNumerosPage() {
  const session = await requireRole(["closer"]);
  const closerId = session.user.id;

  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

  const [stats, ranking, userRow] = await Promise.all([
    getCloserStats(closerId, monthStart, monthEnd),
    getRankingTable("closer"),
    supabaseAdmin().from("users").select("rango").eq("id", closerId).single(),
  ]);

  const currentRango = (userRow.data?.rango as string) ?? "rookie";
  const myPosition = ranking.findIndex((r) => r.user_id === closerId) + 1;

  const RANGO_ORDER = ["rookie", "closer", "elite", "master"];
  const currentIdx = RANGO_ORDER.indexOf(currentRango);
  const nextRango = currentIdx < RANGO_ORDER.length - 1 ? RANGO_ORDER[currentIdx + 1] : null;
  const nextEntry = nextRango ? ranking.find((r) => r.rango === nextRango) : null;

  const monthLabel = monthStart.toLocaleDateString("es", { month: "long", year: "numeric" });

  return (
    <main className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">
        Mis numeros
      </h1>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Leads asignados" value={stats.leads_asignados} />
        <StatCard label="Contactados" value={stats.leads_contactados} />
        <StatCard label="Convertidos" value={stats.leads_convertidos} accent />
        <StatCard label="Close rate" value={`${stats.close_rate.toFixed(1)}%`} />
      </div>

      {/* Rango */}
      <section className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
          Tu rango
        </h2>
        <div className="flex items-center gap-4">
          <span className="text-3xl font-bold text-brand-600 dark:text-brand-400 capitalize">
            {currentRango}
          </span>
          {nextRango && (
            <span className="text-sm text-slate-500 dark:text-slate-400">
              Siguiente: <strong className="capitalize">{nextRango}</strong>
            </span>
          )}
        </div>
        {nextRango && (
          <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-2.5">
            <div
              className="bg-brand-500 h-2.5 rounded-full transition-all"
              style={{
                width: `${Math.min(100, (stats.close_rate / (nextEntry?.close_rate || 100)) * 100)}%`,
              }}
            />
          </div>
        )}
      </section>

      {/* Comisiones del mes */}
      <section className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
          Comisiones — {monthLabel}
        </h2>
        <p className="text-3xl font-bold text-emerald-600 dark:text-emerald-400">
          {(stats.comisiones_cents / 100).toLocaleString("es", { minimumFractionDigits: 2 })} EUR
        </p>
      </section>

      {/* Ranking */}
      <section className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
            Ranking closers {myPosition > 0 && `(tu posicion: #${myPosition})`}
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-left text-xs text-slate-600 dark:text-slate-300">
              <tr>
                <th className="px-4 py-2 font-medium">#</th>
                <th className="px-4 py-2 font-medium">Nombre</th>
                <th className="px-4 py-2 font-medium">Rango</th>
                <th className="px-4 py-2 font-medium text-right">Close rate</th>
                <th className="px-4 py-2 font-medium text-right">Conversiones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {ranking.map((entry, i) => (
                <tr
                  key={entry.user_id}
                  className={`${entry.user_id === closerId ? "bg-brand-50/50 dark:bg-brand-500/5" : ""} hover:bg-slate-50/60 dark:hover:bg-slate-800/40`}
                >
                  <td className="px-4 py-2 text-slate-500">{i + 1}</td>
                  <td className="px-4 py-2 font-medium text-slate-800 dark:text-slate-200">
                    {entry.full_name}
                    {entry.user_id === closerId && <span className="text-brand-600 ml-1">(tu)</span>}
                  </td>
                  <td className="px-4 py-2 capitalize text-slate-600 dark:text-slate-300">{entry.rango}</td>
                  <td className="px-4 py-2 text-right">{entry.close_rate.toFixed(1)}%</td>
                  <td className="px-4 py-2 text-right">{entry.conversiones}</td>
                </tr>
              ))}
              {ranking.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
                    Sin datos de ranking.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border p-5 ${
        accent
          ? "bg-brand-50 dark:bg-brand-500/10 border-brand-200 dark:border-brand-500/30"
          : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800"
      }`}
    >
      <p className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wide">{label}</p>
      <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-slate-50">{value}</p>
    </div>
  );
}
