import { requireRole } from "@/lib/rbac";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic  = "force-dynamic";
export const metadata = { title: "Referidos · Admin" };

/**
 * Tabla simple del sistema de referidos "Regala una clase — gana 3":
 * referidor, lead referido, estado, fecha, recompensas aplicadas.
 */
export default async function ReferidosPage() {
  await requireRole(["superadmin", "admin"]);
  const sb = supabaseAdmin();

  const { data } = await sb
    .from("leads")
    .select(`
      id, name, email, status, created_at, trial_attended_at,
      converted_to_user_id, referral_rewarded_at,
      referrer:students!leads_referred_by_fkey(
        id, referral_code, users!inner(full_name)
      )
    `)
    .not("referred_by", "is", null)
    .order("created_at", { ascending: false })
    .limit(200);

  type Row = {
    id: string; name: string | null; email: string | null; status: string;
    created_at: string; trial_attended_at: string | null;
    converted_to_user_id: string | null; referral_rewarded_at: string | null;
    referrer: {
      id: string; referral_code: string | null;
      users: { full_name: string | null } | Array<{ full_name: string | null }>;
    } | Array<{
      id: string; referral_code: string | null;
      users: { full_name: string | null } | Array<{ full_name: string | null }>;
    }> | null;
  };

  const rows = ((data ?? []) as Row[]).map(r => {
    const ref = Array.isArray(r.referrer) ? r.referrer[0] : r.referrer;
    const ru = ref ? (Array.isArray(ref.users) ? ref.users[0] : ref.users) : null;
    const estado =
      r.converted_to_user_id ? "✅ Convirtió" :
      r.trial_attended_at    ? "🎓 Asistió"  :
      r.status === "trial_scheduled" ? "📅 Agendó" :
      r.status;
    return {
      id:        r.id,
      lead:      r.name ?? r.email ?? r.id.slice(0, 8),
      referidor: ru?.full_name ?? "—",
      codigo:    ref?.referral_code ?? "—",
      estado,
      fecha:     new Date(r.created_at).toLocaleDateString("es-ES"),
      recompensa: r.referral_rewarded_at
        ? `✅ ${new Date(r.referral_rewarded_at).toLocaleDateString("es-ES")} (+3/+1)`
        : "—",
    };
  });

  return (
    <main className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">
          🎁 Referidos
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Leads que llegaron con un código de referido. Recompensa: +3 clases
          al referidor y +1 al nuevo al convertirse (una sola vez, sin comisiones).
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-slate-400 italic">Todavía no hay leads referidos.</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-700">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800 text-left">
              <tr>
                {["Referidor", "Código", "Lead referido", "Estado", "Fecha", "Recompensa"].map(h => (
                  <th key={h} className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-900">
              {rows.map(r => (
                <tr key={r.id}>
                  <td className="px-4 py-2.5 font-medium text-slate-900 dark:text-slate-100">{r.referidor}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-500">{r.codigo}</td>
                  <td className="px-4 py-2.5">
                    <a href={`/admin/leads/${r.id}`} className="text-brand-600 dark:text-brand-400 hover:underline">
                      {r.lead}
                    </a>
                  </td>
                  <td className="px-4 py-2.5">{r.estado}</td>
                  <td className="px-4 py-2.5 text-slate-500">{r.fecha}</td>
                  <td className="px-4 py-2.5">{r.recompensa}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
