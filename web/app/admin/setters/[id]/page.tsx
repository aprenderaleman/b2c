import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/rbac";
import { supabaseAdmin } from "@/lib/supabase";
import { getSetterMetrics } from "@/lib/setter-metrics";
import { SetterMetricsBoard } from "@/components/setter/SetterMetricsBoard";
import { ImpersonateButton } from "@/components/admin/ImpersonateButton";

export const metadata = { title: "Setter · Admin" };
export const dynamic = "force-dynamic";

const RANGES = [
  { days: 1, label: "Hoy" },
  { days: 7, label: "7 días" },
  { days: 30, label: "30 días" },
];

export default async function SetterDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ days?: string }>;
}) {
  await requireRole(["superadmin", "admin"]);
  const { id } = await params;
  const sp = await searchParams;
  const days = Math.min(365, Math.max(1, parseInt(sp.days ?? "7", 10) || 7));

  const sb = supabaseAdmin();
  const { data: setterRow } = await sb
    .from("users")
    .select("id, full_name, email, phone, active, created_at")
    .eq("id", id)
    .eq("role", "setter")
    .maybeSingle();
  if (!setterRow) notFound();
  const setter = setterRow as {
    id: string; full_name: string | null; email: string; phone: string | null;
    active: boolean; created_at: string;
  };

  const metrics = await getSetterMetrics(days, setter.id);

  return (
    <main className="space-y-5">
      <div>
        <Link href="/admin/setters" className="text-sm text-slate-500 dark:text-slate-400 hover:text-brand-600 dark:hover:text-brand-400">
          &larr; Volver a setters
        </Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">
              {setter.full_name ?? setter.email}
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {setter.email}{setter.phone ? ` · ${setter.phone}` : ""} · {setter.active ? "Activo" : "Inactivo"}
            </p>
          </div>
          {setter.active && (
            <ImpersonateButton userId={setter.id} userName={setter.full_name ?? setter.email} role="setter" />
          )}
        </div>
      </div>

      <div className="flex gap-2">
        {RANGES.map((r) => (
          <Link
            key={r.days}
            href={`/admin/setters/${setter.id}?days=${r.days}`}
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

      <SetterMetricsBoard m={metrics} title={`Métricas — últimos ${days === 1 ? "24h" : `${days} días`}`} />

      <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 text-sm text-slate-600 dark:text-slate-300 space-y-1">
        <p className="font-semibold text-slate-900 dark:text-slate-100">Cómo leer el marcador</p>
        <p>· <strong>Delta de asistencia</strong>: show-rate de citas con contacto del setter antes de la cita vs. sin contacto, mismo periodo. Es la métrica que decide su continuidad — pero solo es interpretable con <strong>cobertura ≥80%</strong>; con cobertura baja, compara el show-rate global contra el periodo anterior.</p>
        <p>· <strong>Rescatados</strong>: no-shows marcados que reagendó (y cuántos asistieron después). Los no-shows &quot;sin marcar&quot; cuentan cuando el profe/closer marca la ausencia.</p>
        <p>· <strong>Velocidad</strong>: mediana de horas hábiles (08–22 Berlín) entre el agendado y su primer contacto.</p>
        <p>· <strong>Ventas originadas</strong>: conversiones posteriores a un rescate suyo. Informativa — no toca comisiones.</p>
      </section>
    </main>
  );
}
