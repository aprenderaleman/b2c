import { listTrialClasses, partitionByTime } from "@/lib/trial-classes";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { TrialHubList } from "@/app/profesor/clasedeprueba/TrialHubList";

export const dynamic = "force-dynamic";
export const metadata = { title: "Clases de prueba · Admin" };

export default async function AdminTrialClassesPage() {
  const rows = await listTrialClasses();
  const { upcoming, past } = partitionByTime(rows);
  const session = await auth();
  const canDelete = (session?.user as { role?: string } | undefined)?.role === "superadmin";

  const convertedUserIds = [
    ...new Set(
      rows
        .map((r) => r.leadConvertedToUserId)
        .filter((x): x is string => !!x),
    ),
  ];
  const studentMap: Record<string, string> = {};
  if (convertedUserIds.length > 0) {
    const sb = supabaseAdmin();
    const { data: students } = await sb
      .from("students")
      .select("id, user_id")
      .in("user_id", convertedUserIds);
    for (const s of students ?? []) {
      studentMap[s.user_id] = s.id;
    }
  }

  return (
    <main className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">
          Clases de prueba
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {upcoming.length} próxima{upcoming.length === 1 ? "" : "s"} ·{" "}
          {past.length} pasada{past.length === 1 ? "" : "s"}.
        </p>
      </header>

      {upcoming.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300 mb-3">
            Siguiente clase
          </h2>
          <div className="rounded-2xl ring-2 ring-emerald-400/60 dark:ring-emerald-500/40 shadow-md">
            <TrialHubList rows={[upcoming[0]]} studentMap={studentMap} isAdmin canDelete={canDelete} />
          </div>
        </section>
      )}

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300 mb-3">
          {upcoming.length > 1 ? "Siguientes" : "Próximas"}
        </h2>
        {upcoming.length <= 1 ? (
          <EmptyState text={upcoming.length === 0 ? "No hay clases de prueba agendadas." : "No hay más clases agendadas después de la siguiente."} />
        ) : (
          <TrialHubList rows={upcoming.slice(1)} studentMap={studentMap} isAdmin canDelete={canDelete} />
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300 mb-3">
          Historial
        </h2>
        {past.length === 0 ? (
          <EmptyState text="Aún no hay clases de prueba pasadas." />
        ) : (
          <TrialHubList rows={past} studentMap={studentMap} isAdmin canDelete={canDelete} />
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
