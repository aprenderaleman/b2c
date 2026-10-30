import { CalendarSyncButton } from "@/components/calendar/CalendarSyncButton";
import { goalLevelEs, ritmoLabelEs, type getStudentByUserId } from "@/lib/academy";

/**
 * Tarjeta "Tu plan" del estudiante: nivel → meta, ritmo, completadas /
 * restantes / total y % de progreso + botón de sincronizar calendario.
 * Vivía en /estudiante (Hoy); desde 2026-10-30 (Gelfis) se muestra SOLO
 * en /estudiante/perfil. Mismos datos que ven admin y profe.
 * Total = clases_totales (contrato); restantes lo recalcula la DB al
 * completar cada clase.
 */
export function PlanSection({ student, icalUrl }: {
  student: NonNullable<Awaited<ReturnType<typeof getStudentByUserId>>>;
  icalUrl: string | null;
}) {
  const total = student.clases_totales ?? student.classes_purchased ?? 0;
  const remaining = student.classes_remaining ?? 0;
  const done = Math.max(0, total - remaining);
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const isSubscription = student.subscription_type === "monthly_subscription";

  return (
    <section className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
            Tu plan
          </h2>
          <p className="mt-3 text-sm text-slate-700 dark:text-slate-200">
            <strong>{student.current_level}</strong>
            <span className="text-slate-400 mx-1.5">→</span>
            Meta <strong>{goalLevelEs(student.goal)}</strong>
            <span className="text-slate-400 mx-1.5">·</span>
            Ritmo <strong>{ritmoLabelEs(student)}</strong>
            {isSubscription && student.classes_per_month && (
              <span className="text-slate-500 dark:text-slate-400"> ({student.classes_per_month} clases/mes)</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {icalUrl && <CalendarSyncButton icalUrl={icalUrl} />}
        </div>
      </div>

      {total > 0 ? (
        <div className="mt-4">
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="rounded-2xl bg-brand-50 dark:bg-brand-500/10 p-3">
              <div className="text-2xl font-bold tabular-nums text-brand-700 dark:text-brand-300">{done}</div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">Completadas</div>
            </div>
            <div className={`rounded-2xl p-3 ${remaining <= 4 ? "bg-red-50 dark:bg-red-500/10" : "bg-emerald-50 dark:bg-emerald-500/10"}`}>
              <div className={`text-2xl font-bold tabular-nums ${remaining <= 4 ? "text-red-700 dark:text-red-300" : "text-emerald-700 dark:text-emerald-300"}`}>
                {remaining}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">Restantes</div>
            </div>
            <div className="rounded-2xl bg-slate-100 dark:bg-slate-800 p-3">
              <div className="text-2xl font-bold tabular-nums text-slate-700 dark:text-slate-200">{total}</div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">Total plan</div>
            </div>
          </div>
          <div className="mt-3">
            <div className="flex justify-between text-[11px] text-slate-500 dark:text-slate-400 mb-1">
              <span>Progreso hacia {goalLevelEs(student.goal)}</span>
              <span className="tabular-nums">{pct}%</span>
            </div>
            <div className="h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
              <div className="h-full rounded-full bg-brand-500" style={{ width: `${pct}%` }} />
            </div>
          </div>
        </div>
      ) : (
        <p className="mt-4 text-sm text-slate-600 dark:text-slate-300">
          {remaining} clases restantes
        </p>
      )}
    </section>
  );
}
