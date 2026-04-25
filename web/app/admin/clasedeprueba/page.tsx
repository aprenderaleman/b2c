import { listTrialClasses, partitionByTime } from "@/lib/trial-classes";
import { TrialClassCard } from "@/components/TrialClassCard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Clases de prueba · Admin" };

/**
 * Admin view of EVERY trial class in the system. Built so Gelfis can
 * eyeball who is showing up tomorrow without paging through the
 * generic /admin/clases list. Each row exposes a one-click WhatsApp
 * and email contact for the lead.
 */
export default async function AdminTrialClassesPage() {
  const rows = await listTrialClasses();
  const { upcoming, past } = partitionByTime(rows);

  return (
    <main className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">
          Clases de prueba
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {upcoming.length} próxima{upcoming.length === 1 ? "" : "s"} ·{" "}
          {past.length} pasada{past.length === 1 ? "" : "s"}.
          Solo aparecen las clases marcadas como <code className="text-xs">is_trial</code>.
        </p>
      </header>

      {/* ── Upcoming ── */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300 mb-3">
          Próximas
        </h2>
        {upcoming.length === 0 ? (
          <EmptyState text="No hay clases de prueba agendadas." />
        ) : (
          <div className="grid gap-3">
            {upcoming.map((r) => (
              <TrialClassCard key={r.classId} row={r} showLeadDetailLink />
            ))}
          </div>
        )}
      </section>

      {/* ── Past ── */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300 mb-3">
          Historial
        </h2>
        {past.length === 0 ? (
          <EmptyState text="Aún no hay clases de prueba pasadas." />
        ) : (
          <div className="grid gap-3">
            {past.map((r) => (
              <TrialClassCard key={r.classId} row={r} showLeadDetailLink />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-200 dark:border-slate-700 bg-white/40 dark:bg-slate-900/40 p-6 text-sm text-slate-500 dark:text-slate-400 text-center">
      {text}
    </div>
  );
}
