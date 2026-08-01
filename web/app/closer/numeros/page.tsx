import { requireRole } from "@/lib/rbac";
import { getCloserDetailedStats } from "@/lib/closer-commissions";
import { getRankingTable } from "@/lib/ranking";
import { supabaseAdmin } from "@/lib/supabase";

export const metadata = { title: "Mis numeros · Closer" };

const RANGO_ORDER = ["rookie", "closer", "elite", "master"];
const RANGO_PCT: Record<string, number> = { rookie: 8, closer: 10, elite: 12, master: 15 };

function fmtEur(cents: number): string {
  return (cents / 100).toLocaleString("es", { minimumFractionDigits: 2 });
}

export default async function CloserNumerosPage() {
  const session = await requireRole(["closer"]);
  const closerId = session.user.id;

  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

  const [stats, ranking, userRow] = await Promise.all([
    getCloserDetailedStats(closerId, monthStart, monthEnd),
    getRankingTable("closer"),
    supabaseAdmin().from("users").select("rango").eq("id", closerId).single(),
  ]);

  const currentRango = (userRow.data?.rango as string) ?? "rookie";
  const myPosition = ranking.findIndex((r) => r.user_id === closerId) + 1;
  const currentIdx = RANGO_ORDER.indexOf(currentRango);
  const nextRango = currentIdx < RANGO_ORDER.length - 1 ? RANGO_ORDER[currentIdx + 1] : null;

  const monthLabel = monthStart.toLocaleDateString("es", { month: "long", year: "numeric" });
  const currentPct = RANGO_PCT[currentRango] ?? 8;
  const nextPct = nextRango ? (RANGO_PCT[nextRango] ?? currentPct) : null;

  return (
    <main className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">
        Mis numeros
      </h1>

      {/* Close rate + Rango hero */}
      <section className="rounded-3xl bg-gradient-to-br from-brand-50 to-white dark:from-brand-500/5 dark:to-slate-900 border border-brand-200 dark:border-brand-500/20 p-6">
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <p className="text-xs uppercase tracking-wider text-brand-600 dark:text-brand-400">
              Close rate — {monthLabel}
            </p>
            <p className="text-5xl font-extrabold text-slate-900 dark:text-slate-50 mt-1">
              {stats.close_rate.toFixed(1)}%
            </p>
          </div>
          <div className="text-right">
            <p className="text-3xl font-bold text-brand-600 dark:text-brand-400 capitalize">
              {currentRango}
            </p>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Comision: {currentPct}%
            </p>
          </div>
        </div>

        {nextRango && (
          <div className="mt-4">
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-1">
              <span className="capitalize">{currentRango} ({currentPct}%)</span>
              <span className="capitalize">{nextRango} ({nextPct}%)</span>
            </div>
            <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2.5">
              <div
                className="bg-brand-500 h-2.5 rounded-full transition-all"
                style={{
                  width: `${Math.min(100, (stats.close_rate / (RANGO_PCT[nextRango] ? 30 : 100)) * 100)}%`,
                }}
              />
            </div>
          </div>
        )}
      </section>

      {/* KPIs grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Leads asignados" value={stats.leads_asignados} />
        <StatCard label="Contactados" value={stats.leads_contactados} />
        <StatCard label="Convertidos" value={stats.leads_convertidos} accent />
        <StatCard label="Tasa contacto" value={`${stats.tasa_contacto.toFixed(1)}%`} />
      </div>

      {/* Comisiones del mes */}
      <section className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
          Comisiones — {monthLabel}
        </h2>

        <p className="text-3xl font-bold text-emerald-600 dark:text-emerald-400">
          {fmtEur(stats.comisiones_cents)} EUR
        </p>

        {/* Breakdown */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <ComisionCard
            label="Base"
            amount={stats.comisiones_by_tipo.comision_base}
          />
          <ComisionCard
            label="Rescate (E3)"
            amount={stats.comisiones_by_tipo.bono_rescate}
            badge="+3%"
          />
          <ComisionCard
            label="Pre-calif. (E2)"
            amount={stats.comisiones_by_tipo.comision_precalificacion}
          />
        </div>

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

function ComisionCard({
  label,
  amount,
  badge,
}: {
  label: string;
  amount: number;
  badge?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-100 dark:border-slate-800 p-3">
      <div className="flex items-center gap-1.5">
        <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
        {badge && (
          <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 rounded-full px-1.5 py-0">
            {badge}
          </span>
        )}
      </div>
      <p className="text-lg font-semibold text-slate-800 dark:text-slate-200 mt-0.5">
        {fmtEur(amount)} EUR
      </p>
    </div>
  );
}
