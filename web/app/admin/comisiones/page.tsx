import { getTeacherCommissions } from "@/lib/teacher-commission";
import { requireRole } from "@/lib/rbac";
import { supabaseAdmin } from "@/lib/supabase";
import { RankEditor } from "./rank-editor";

export const dynamic = "force-dynamic";
export const metadata = { title: "Comisiones · Admin" };

const RANK_BADGES: Record<string, string> = {
  starter: "🌱 Starter",
  pro: "⭐ Pro",
  elite: "🔥 Elite",
  master: "👑 Master",
};

export default async function AdminComisionesPage() {
  await requireRole(["admin", "superadmin"]);

  const sb = supabaseAdmin();

  const currentMonth = new Date().toISOString().slice(0, 7) + "-01";

  const { data: teachers } = await sb
    .from("teachers")
    .select("id, user_id, users!inner(full_name, rango)")
    .eq("active", true)
    .order("users(full_name)");

  // % efectivo por profe: comisión acordada (número libre) o la del rango.
  const commissionByUser = await getTeacherCommissions(
    ((teachers ?? []) as unknown as Array<{ user_id: string }>).map(t => t.user_id),
  );

  const { data: comisiones } = await sb
    .from("comisiones")
    .select("usuario_id, monto_cents")
    .eq("mes", currentMonth);

  const comisionByUser = new Map<string, number>();
  for (const c of (comisiones ?? []) as Array<{ usuario_id: string; monto_cents: number }>) {
    comisionByUser.set(c.usuario_id, (comisionByUser.get(c.usuario_id) ?? 0) + c.monto_cents);
  }

  const rows = ((teachers ?? []) as unknown as Array<{
    id: string; user_id: string;
    users: { full_name: string; rango: string | null };
  }>).map(t => {
    const rango = t.users.rango ?? "starter";
    const commission = commissionByUser.get(t.user_id);
    const pct = commission?.pct ?? 5;
    const custom = commission?.custom ?? false;
    const totalCents = comisionByUser.get(t.user_id) ?? 0;
    return {
      teacherId: t.id,
      userId: t.user_id,
      name: t.users.full_name,
      rango,
      pct,
      custom,
      totalCents,
    };
  });

  const grandTotal = rows.reduce((s, r) => s + r.totalCents, 0);

  return (
    <main className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">
          Comisiones por conversion
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Mes actual · Total: <strong>{(grandTotal / 100).toFixed(2)} EUR</strong>
        </p>
      </header>

      <section className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wide">
              <tr>
                <th className="pb-3 pr-4">Profesor</th>
                <th className="pb-3 pr-4">Rango</th>
                <th className="pb-3 pr-4">%</th>
                <th className="pb-3 pr-4">Comisiones mes</th>
                <th className="pb-3 pr-4">Cambiar rango / comisión acordada</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {rows.map(r => (
                <tr key={r.teacherId} className="text-slate-800 dark:text-slate-200">
                  <td className="py-3 pr-4 font-medium">{r.name}</td>
                  <td className="py-3 pr-4">{RANK_BADGES[r.rango] ?? r.rango}</td>
                  <td className="py-3 pr-4 tabular-nums">{String(r.pct).replace(".", ",")}%{r.custom ? <span className="ml-1 text-[11px] text-slate-500 dark:text-slate-400">acordado</span> : null}</td>
                  <td className="py-3 pr-4 tabular-nums font-semibold text-emerald-600 dark:text-emerald-400">
                    {(r.totalCents / 100).toFixed(2)} EUR
                  </td>
                  <td className="py-3 pr-4">
                    <RankEditor teacherId={r.teacherId} currentRank={r.rango} customPct={r.custom ? r.pct : null} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
