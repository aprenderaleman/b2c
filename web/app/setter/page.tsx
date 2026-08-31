import Link from "next/link";
import { redirect } from "next/navigation";
import { requireRoleWithImpersonation } from "@/lib/rbac";
import { getSetterQueue, type SetterQueueItem, type SetterTramo } from "@/lib/setter-queue";
import { getSetterMetrics } from "@/lib/setter-metrics";
import { SetterMetricsBoard } from "@/components/setter/SetterMetricsBoard";
import { formatBerlinShort } from "@/lib/time";

export const metadata = { title: "Mi cola · Setter" };
export const dynamic = "force-dynamic";

const TRAMOS: Array<{ key: SetterTramo; title: string; hint: string }> = [
  { key: "sin_confirmar", title: "📋 Recién agendadas — llamar para confirmar", hint: "Confirma la cita y pregunta qué quiere lograr. La agendada hace más tiempo, primero." },
  { key: "hoy_manana",    title: "⏰ Hoy y mañana — recordatorio", hint: "Llamada o nota de voz recordando la cita." },
  { key: "no_show_7d",    title: "🔄 No-shows últimos 7 días — rescatar", hint: "Llamar y reagendar en la misma llamada." },
  { key: "backlog",       title: "📦 Backlog de no-shows (7–45 días)", hint: "Segundo intento de rescate." },
];

export default async function SetterColaPage() {
  const session = await requireRoleWithImpersonation(["setter", "admin", "superadmin"], "setter");
  if (session.user.role !== "setter") redirect("/admin/setters");

  const [queue, metrics] = await Promise.all([
    getSetterQueue(),
    getSetterMetrics(7, session.user.id),
  ]);

  const byTramo = new Map<SetterTramo, SetterQueueItem[]>();
  for (const it of queue) {
    const arr = byTramo.get(it.tramo) ?? [];
    arr.push(it);
    byTramo.set(it.tramo, arr);
  }

  return (
    <main className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Mi cola</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Tu misión: que cada cita agendada se convierta en asistencia. Cada llamada se registra con nota.
        </p>
      </header>

      <SetterMetricsBoard m={metrics} title="Mi marcador — últimos 7 días" />

      {queue.length === 0 && (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          🎉 Cola vacía — no hay citas pendientes de confirmar, recordar ni rescatar.
        </p>
      )}

      {TRAMOS.map(({ key, title, hint }) => {
        const items = byTramo.get(key) ?? [];
        if (items.length === 0) return null;
        return (
          <section key={key} className="space-y-2">
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                {title} <span className="text-slate-400 font-normal">({items.length})</span>
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">{hint}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 divide-y divide-slate-100 dark:divide-slate-800">
              {items.map((it) => (
                <Link
                  key={`${it.classId}-${it.tramo}`}
                  href={`/setter/leads/${it.leadId}`}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                >
                  <span className="font-medium text-slate-900 dark:text-slate-100 min-w-[8rem]">
                    {it.lead.name ?? "(sin nombre)"}
                  </span>
                  <span className="text-xs rounded-full px-2 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                    {it.citaTipo === "trial" ? "Clase de prueba" : "Sesión de plan"}
                  </span>
                  <span className="text-sm text-slate-600 dark:text-slate-300">
                    {formatBerlinShort(it.citaAt)}
                    {it.hostName ? ` · ${it.hostName.split(/\s+/)[0]}` : ""}
                  </span>
                  {it.sinMarcar && (
                    <span className="text-xs rounded-full px-2 py-0.5 bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 font-medium">
                      sin marcar
                    </span>
                  )}
                  <span className="ml-auto text-xs text-slate-400">
                    {it.lastSetterContact
                      ? `Último toque: ${formatBerlinShort(it.lastSetterContact.occurred_at)}`
                      : "Sin contactar"}
                  </span>
                </Link>
              ))}
            </div>
          </section>
        );
      })}
    </main>
  );
}
