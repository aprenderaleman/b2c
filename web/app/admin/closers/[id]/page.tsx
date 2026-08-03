import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/rbac";
import { supabaseAdmin } from "@/lib/supabase";
import { getCloserDetailedStats } from "@/lib/closer-commissions";
import { getCloserQueue } from "@/lib/closer-semaforo";
import { ImpersonateButton } from "@/components/admin/ImpersonateButton";

export const metadata = { title: "Closer · Admin" };

const RANGO_PCT: Record<string, number> = { rookie: 8, closer: 10, elite: 12, master: 15 };

const ESTADO_LABEL: Record<string, { label: string; cls: string }> = {
  activo:              { label: "Activo",               cls: "bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-500/30" },
  seguimiento_pactado: { label: "📅 Seguimiento pactado", cls: "bg-violet-50 dark:bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-500/30" },
  convertido:          { label: "Convertido",           cls: "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30" },
  en_reactivacion:     { label: "🌙 En reactivación",   cls: "bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-500/30" },
  perdido:             { label: "Perdido",              cls: "bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 border-red-200 dark:border-red-500/30" },
};

function fmtEur(cents: number): string {
  return (cents / 100).toLocaleString("es", { minimumFractionDigits: 2 }) + " €";
}

export default async function AdminCloserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole(["superadmin", "admin"]);
  const { id } = await params;

  const sb = supabaseAdmin();
  const { data: closer } = await sb
    .from("users")
    .select("id, email, full_name, phone, active, rango, flujo_activo, created_at")
    .eq("id", id)
    .eq("role", "closer")
    .maybeSingle();

  if (!closer) notFound();

  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

  const [stats, queue, leadsRes] = await Promise.all([
    getCloserDetailedStats(id, monthStart, monthEnd),
    getCloserQueue(id),
    sb
      .from("leads")
      .select("id, name, estado_cierre, fecha_asignacion_closer, trial_attended_at, trial_absent_at, motivo_perdido")
      .eq("closer_id", id)
      .order("fecha_asignacion_closer", { ascending: false, nullsFirst: false })
      .limit(100),
  ]);

  const leads = (leadsRes.data ?? []) as Array<{
    id: string;
    name: string | null;
    estado_cierre: string;
    fecha_asignacion_closer: string | null;
    trial_attended_at: string | null;
    trial_absent_at: string | null;
    motivo_perdido: string | null;
  }>;

  const rojos = queue.filter((i) => i.color === "rojo").length;
  const amarillos = queue.filter((i) => i.color === "amarillo").length;
  const verdes = queue.filter((i) => i.color === "verde").length;

  const byEstado: Record<string, number> = {};
  for (const l of leads) byEstado[l.estado_cierre] = (byEstado[l.estado_cierre] ?? 0) + 1;

  const rango = (closer.rango as string) ?? "rookie";
  const monthLabel = monthStart.toLocaleDateString("es", { month: "long", year: "numeric" });

  return (
    <main className="space-y-5">
      <Link href="/admin/closers" className="text-sm text-slate-500 dark:text-slate-400 hover:text-brand-600 dark:hover:text-brand-400">
        &larr; Closers
      </Link>

      {/* Header */}
      <header className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50 flex items-center gap-2 flex-wrap">
              {closer.full_name ?? closer.email}
              <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase bg-brand-50 dark:bg-brand-500/10 text-brand-700 dark:text-brand-300 border-brand-200 dark:border-brand-500/30 capitalize">
                {rango} · {RANGO_PCT[rango] ?? 8}%
              </span>
              {!closer.active && (
                <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase bg-slate-100 text-slate-600 border-slate-300">
                  Inactivo
                </span>
              )}
              {!closer.flujo_activo && (
                <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase bg-amber-50 text-amber-700 border-amber-200">
                  Fuera de rotación
                </span>
              )}
            </h1>
            <div className="mt-1 flex items-center gap-3 text-sm text-slate-600 dark:text-slate-300 flex-wrap">
              <a href={`mailto:${closer.email}`} className="font-mono text-brand-600 dark:text-brand-400 hover:underline">
                {closer.email}
              </a>
              {closer.phone && (
                <>
                  <span className="text-slate-300 dark:text-slate-600">·</span>
                  <span className="font-mono">{closer.phone}</span>
                </>
              )}
              <span className="text-slate-300 dark:text-slate-600">·</span>
              <span>Alta: {new Date(closer.created_at).toLocaleDateString("es-ES")}</span>
            </div>
          </div>

          <ImpersonateButton
            userId={closer.id}
            userName={closer.full_name ?? closer.email}
            role="closer"
          />
        </div>
      </header>

      {/* Stats del mes */}
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label={`Close rate (${monthLabel})`} value={`${stats.close_rate.toFixed(1)}%`} accent />
        <Stat label="Convertidos" value={String(stats.leads_convertidos)} />
        <Stat label="Perdidos" value={String(stats.leads_perdidos)} />
        <Stat label="Comisiones" value={fmtEur(stats.comisiones_cents)} />
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Cola actual (semáforo) */}
        <section className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
            Cola HOY (semáforo)
          </h2>
          <div className="mt-3 flex items-center gap-4 text-sm font-semibold">
            <span className="text-red-600 dark:text-red-400">🔴 {rojos}</span>
            <span className="text-amber-600 dark:text-amber-400">🟡 {amarillos}</span>
            <span className="text-emerald-600 dark:text-emerald-400">🟢 {verdes}</span>
            {rojos === 0 && amarillos === 0 && (
              <span className="text-emerald-600 dark:text-emerald-400">✅ al día</span>
            )}
          </div>
          <ul className="mt-3 space-y-1.5">
            {queue.slice(0, 8).map((i) => (
              <li key={i.leadId} className="flex items-center gap-2 text-sm">
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${i.color === "rojo" ? "bg-red-500" : i.color === "amarillo" ? "bg-amber-400" : "bg-emerald-500"}`} />
                <Link href={`/admin/leads/${i.leadId}`} className="font-medium text-slate-800 dark:text-slate-200 hover:underline truncate">
                  {i.leadName}
                </Link>
                <span className="text-xs text-slate-500 dark:text-slate-400 truncate">{i.reason}</span>
              </li>
            ))}
            {queue.length === 0 && <li className="text-sm text-slate-400">Cola vacía.</li>}
          </ul>
        </section>

        {/* Distribución por estado */}
        <section className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
            Cartera ({leads.length} leads)
          </h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {Object.entries(byEstado).map(([estado, n]) => {
              const meta = ESTADO_LABEL[estado] ?? { label: estado, cls: "bg-slate-50 text-slate-600 border-slate-200" };
              return (
                <span key={estado} className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium ${meta.cls}`}>
                  {meta.label} <strong>{n}</strong>
                </span>
              );
            })}
          </div>
          <div className="mt-3 text-xs text-slate-500 dark:text-slate-400">
            Comisiones del mes: base {fmtEur(stats.comisiones_by_tipo.comision_base)} · rescate {fmtEur(stats.comisiones_by_tipo.bono_rescate)} · pre-calif. {fmtEur(stats.comisiones_by_tipo.comision_precalificacion)}
          </div>
        </section>
      </div>

      {/* Leads asignados */}
      <section className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
            Leads asignados
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-left text-xs text-slate-600 dark:text-slate-300">
              <tr>
                <th className="px-4 py-2 font-medium">Lead</th>
                <th className="px-4 py-2 font-medium">Trial</th>
                <th className="px-4 py-2 font-medium">Estado</th>
                <th className="px-4 py-2 font-medium">Asignado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {leads.map((l) => {
                const meta = ESTADO_LABEL[l.estado_cierre] ?? { label: l.estado_cierre, cls: "bg-slate-50 text-slate-600 border-slate-200" };
                return (
                  <tr key={l.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                    <td className="px-4 py-2">
                      <Link href={`/admin/leads/${l.id}`} className="font-medium text-slate-800 dark:text-slate-200 hover:underline">
                        {l.name ?? "Lead"}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-xs">
                      {l.trial_attended_at
                        ? <span className="text-emerald-600 dark:text-emerald-400">✓ asistió</span>
                        : l.trial_absent_at
                          ? <span className="text-red-600 dark:text-red-400">✗ no asistió</span>
                          : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-4 py-2">
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${meta.cls}`}>
                        {meta.label}
                      </span>
                      {l.estado_cierre === "perdido" && l.motivo_perdido && (
                        <span className="ml-2 text-[11px] text-slate-400">({l.motivo_perdido})</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-xs text-slate-500 dark:text-slate-400">
                      {l.fecha_asignacion_closer ? new Date(l.fecha_asignacion_closer).toLocaleDateString("es-ES") : "—"}
                    </td>
                  </tr>
                );
              })}
              {leads.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-slate-400">Sin leads asignados.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`rounded-3xl border p-4 ${accent
      ? "bg-brand-50/60 dark:bg-brand-500/5 border-brand-200 dark:border-brand-500/20"
      : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800"}`}>
      <p className="text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-slate-50">{value}</p>
    </div>
  );
}
