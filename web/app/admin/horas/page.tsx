import { requireRole } from "@/lib/rbac";
import {
  getHoursAuditData,
  moneyFromCents,
  formatMonthEs,
} from "@/lib/finance";
import { HorasMonthPicker } from "./MonthPicker";
import { BillButton, BillAllButton } from "./BillButton";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const metadata = { title: "Horas · Admin" };

export default async function HorasPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  await requireRole(["superadmin", "admin"]);
  const sp = await searchParams;

  const now = new Date();
  const focus = sp.month ? new Date(sp.month + "-01T00:00:00Z") : now;
  const monthStr = focus.toISOString().slice(0, 7);

  const { teachers, unbilled, earnings } = await getHoursAuditData(focus);

  const totalBilled = teachers.reduce((s, t) => s + t.total_bh, 0);
  const totalUnbilled = unbilled.length;
  const withEvidence = unbilled.filter((u) => u.evidence !== "none");
  const withoutEvidence = unbilled.filter((u) => u.evidence === "none");
  const totalEarningsCents = earnings.reduce(
    (s, e) => s + e.amount_cents,
    0
  );
  const pendingCents = earnings
    .filter((e) => !e.paid)
    .reduce((s, e) => s + e.amount_cents, 0);

  const rateIssues = teachers.filter(
    (t) => t.rate_individual_cents === 0 || t.rate_group_cents === 0
  );

  return (
    <main className="space-y-5">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <Link
            href="/admin/finanzas"
            className="text-sm text-slate-500 dark:text-slate-400 hover:text-brand-600 dark:hover:text-brand-400"
          >
            ← Finanzas
          </Link>
          <h1 className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-50">
            Reconciliación de horas{" "}
            <span className="capitalize font-normal text-slate-600 dark:text-slate-400">
              · {formatMonthEs(focus.toISOString())}
            </span>
          </h1>
        </div>
        <HorasMonthPicker currentMonth={monthStr} />
      </header>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Horas facturadas" value={String(totalBilled)} />
        <StatCard
          label="Coste profes"
          value={moneyFromCents(totalEarningsCents)}
        />
        <StatCard
          label="Pendiente pago"
          value={moneyFromCents(pendingCents)}
          accent={pendingCents > 0 ? "amber" : undefined}
        />
        <StatCard
          label="Sin facturar"
          value={String(totalUnbilled)}
          accent={totalUnbilled > 0 ? "red" : undefined}
        />
      </div>

      {/* Per-teacher breakdown */}
      <section className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
            Resumen por profesor
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-left text-xs text-slate-600 dark:text-slate-300">
              <tr>
                <Th>Profesor</Th>
                <Th>Completadas</Th>
                <Th>Facturadas</Th>
                <Th>Sin facturar</Th>
                <Th>Trials</Th>
                <Th>Total BH</Th>
                <Th>Agendadas</Th>
                <Th>Tarifa</Th>
                <Th>Ganancia</Th>
                <Th>Estado</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-800 dark:text-slate-200">
              {teachers.length === 0 && (
                <tr>
                  <td
                    colSpan={10}
                    className="p-8 text-center text-slate-500 dark:text-slate-400"
                  >
                    Sin datos para este mes.
                  </td>
                </tr>
              )}
              {teachers.map((t) => {
                const earning = earnings.find(
                  (e) => e.teacher_id === t.teacher_id
                );
                return (
                  <tr
                    key={t.teacher_id}
                    className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40"
                  >
                    <Td className="font-medium">{t.teacher_name}</Td>
                    <Td>{t.completed}</Td>
                    <Td>{t.billed}</Td>
                    <Td>
                      {t.unbilled_non_trial > 0 ? (
                        <span className="text-red-600 dark:text-red-400 font-semibold">
                          {t.unbilled_non_trial}
                        </span>
                      ) : (
                        <span className="text-emerald-600 dark:text-emerald-400">
                          0
                        </span>
                      )}
                    </Td>
                    <Td className="text-slate-400">{t.trials}</Td>
                    <Td className="font-mono">{t.total_bh}</Td>
                    <Td>{t.upcoming}</Td>
                    <Td className="font-mono text-xs">
                      {t.rate_individual_cents / 100} €
                      {t.rate_individual_cents === 0 && (
                        <span className="ml-1 text-red-500">⚠</span>
                      )}
                    </Td>
                    <Td className="font-mono">
                      {earning
                        ? moneyFromCents(earning.amount_cents)
                        : "—"}
                    </Td>
                    <Td>
                      {earning?.paid ? (
                        <span className="inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-300 text-xs">
                          <span className="h-2 w-2 rounded-full bg-emerald-500" />
                          Pagado
                        </span>
                      ) : earning ? (
                        <span className="inline-flex items-center gap-1.5 text-amber-700 dark:text-amber-300 text-xs">
                          <span className="h-2 w-2 rounded-full bg-amber-500" />
                          Pendiente
                        </span>
                      ) : (
                        <span className="text-slate-400 text-xs">—</span>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Unbilled classes with evidence */}
      {withEvidence.length > 0 && (
        <section className="rounded-3xl bg-white dark:bg-slate-900 border border-red-200 dark:border-red-500/30 overflow-hidden">
          <div className="px-4 py-3 border-b border-red-100 dark:border-red-500/20 flex items-center justify-between gap-3 flex-wrap">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-red-700 dark:text-red-300">
              Clases sin facturar CON evidencia ({withEvidence.length})
            </h2>
            <BillAllButton
              classIds={withEvidence
                .filter((u) => u.computed_bh > 0)
                .map((u) => ({ id: u.id, bh: u.computed_bh }))}
            />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-red-50/50 dark:bg-red-500/5 text-left text-xs text-slate-600 dark:text-slate-300">
                <tr>
                  <Th>Profesor</Th>
                  <Th>Fecha</Th>
                  <Th>Clase</Th>
                  <Th>Plan</Th>
                  <Th>Real</Th>
                  <Th>Evidencia</Th>
                  <Th>BH calc.</Th>
                  <Th>Acción</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-800 dark:text-slate-200">
                {withEvidence.map((u) => (
                  <tr key={u.id}>
                    <Td className="font-medium">{u.teacher_name}</Td>
                    <Td className="text-xs font-mono">
                      {new Date(u.scheduled_at).toLocaleDateString("es-ES", {
                        day: "2-digit",
                        month: "2-digit",
                      })}{" "}
                      {new Date(u.scheduled_at).toLocaleTimeString("es-ES", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </Td>
                    <Td className="max-w-[200px] truncate">{u.title}</Td>
                    <Td>{u.duration_minutes} min</Td>
                    <Td>
                      {u.actual_duration_minutes
                        ? `${u.actual_duration_minutes} min`
                        : "—"}
                    </Td>
                    <Td>
                      <EvidenceBadge evidence={u.evidence} recCount={u.rec_count} />
                    </Td>
                    <Td className="font-mono font-semibold">{u.computed_bh}</Td>
                    <Td>
                      <BillButton
                        classId={u.id}
                        computedBh={u.computed_bh}
                      />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Unbilled classes WITHOUT evidence */}
      {withoutEvidence.length > 0 && (
        <section className="rounded-3xl bg-white dark:bg-slate-900 border border-amber-200 dark:border-amber-500/30 overflow-hidden">
          <div className="px-4 py-3 border-b border-amber-100 dark:border-amber-500/20">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
              Clases sin facturar SIN evidencia ({withoutEvidence.length})
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Necesitan confirmación del profesor antes de facturar.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-amber-50/50 dark:bg-amber-500/5 text-left text-xs text-slate-600 dark:text-slate-300">
                <tr>
                  <Th>Profesor</Th>
                  <Th>Fecha</Th>
                  <Th>Clase</Th>
                  <Th>Plan</Th>
                  <Th>Acción manual</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-800 dark:text-slate-200">
                {withoutEvidence.map((u) => (
                  <tr key={u.id}>
                    <Td className="font-medium">{u.teacher_name}</Td>
                    <Td className="text-xs font-mono">
                      {new Date(u.scheduled_at).toLocaleDateString("es-ES", {
                        day: "2-digit",
                        month: "2-digit",
                      })}{" "}
                      {new Date(u.scheduled_at).toLocaleTimeString("es-ES", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </Td>
                    <Td className="max-w-[200px] truncate">{u.title}</Td>
                    <Td>{u.duration_minutes} min</Td>
                    <Td>
                      <BillButton
                        classId={u.id}
                        computedBh={u.computed_bh}
                      />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Rate warnings */}
      {rateIssues.length > 0 && (
        <section className="rounded-3xl bg-amber-50 dark:bg-amber-500/5 border border-amber-200 dark:border-amber-500/30 p-4 space-y-2">
          <h2 className="text-sm font-semibold text-amber-800 dark:text-amber-300">
            Tarifas con problemas
          </h2>
          <ul className="text-sm text-amber-700 dark:text-amber-200 space-y-1">
            {rateIssues.map((t) => (
              <li key={t.teacher_id}>
                <strong>{t.teacher_name}</strong>:{" "}
                {t.rate_individual_cents === 0 && "individual = 0€ "}
                {t.rate_group_cents === 0 && "grupal = 0€"}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* All clear */}
      {totalUnbilled === 0 && rateIssues.length === 0 && (
        <div className="rounded-3xl bg-emerald-50 dark:bg-emerald-500/5 border border-emerald-200 dark:border-emerald-500/30 p-6 text-center">
          <p className="text-emerald-800 dark:text-emerald-300 font-medium">
            Todo cuadra — sin clases sin facturar ni incidencias.
          </p>
        </div>
      )}

      {/* Cron info */}
      <footer className="text-xs text-slate-400 dark:text-slate-500 flex items-center gap-2">
        <span>
          El cron{" "}
          <code className="bg-slate-100 dark:bg-slate-800 px-1 rounded">
            /api/cron/hours-reconciliation
          </code>{" "}
          ejecuta esta reconciliación automáticamente y envía alertas por email
          cuando detecta clases sin facturar.
        </span>
      </footer>
    </main>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "amber" | "red";
}) {
  const colorClass =
    accent === "amber"
      ? "text-amber-700 dark:text-amber-300"
      : accent === "red"
        ? "text-red-700 dark:text-red-300"
        : "text-slate-900 dark:text-slate-50";
  return (
    <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4">
      <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">
        {label}
      </div>
      <div className={`text-xl font-semibold font-mono ${colorClass}`}>
        {value}
      </div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-3 py-2 font-medium whitespace-nowrap">{children}</th>
  );
}

function Td({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <td className={`px-3 py-2 whitespace-nowrap ${className}`}>{children}</td>
  );
}

function EvidenceBadge({
  evidence,
  recCount,
}: {
  evidence: string;
  recCount: number;
}) {
  if (evidence === "recording") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/10 rounded-full px-2 py-0.5">
        Grabación ({recCount})
      </span>
    );
  }
  if (evidence === "timer") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-500/10 rounded-full px-2 py-0.5">
        Timer
      </span>
    );
  }
  if (evidence === "actual_duration") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-500/10 rounded-full px-2 py-0.5">
        Duración real
      </span>
    );
  }
  return (
    <span className="text-xs text-slate-400 dark:text-slate-500">
      Sin evidencia
    </span>
  );
}
