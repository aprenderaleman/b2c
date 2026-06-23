import { requireRoleWithImpersonation } from "@/lib/rbac";
import { getTeacherByUserId } from "@/lib/academy";
import { listTrialClasses, partitionByTime } from "@/lib/trial-classes";
import { supabaseAdmin } from "@/lib/supabase";
import { TrialHubList } from "./TrialHubList";

export const dynamic = "force-dynamic";
export const metadata = { title: "Clases de prueba · Profesor" };

export default async function TeacherTrialClassesPage() {
  const session = await requireRoleWithImpersonation(
    ["teacher", "admin", "superadmin"],
    "teacher",
  );
  const teacher = await getTeacherByUserId(session.user.id);

  if (!teacher) {
    return (
      <main>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">
          Clases de prueba
        </h1>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          Tu cuenta no tiene un perfil de profesor asociado.
        </p>
      </main>
    );
  }

  const rows = await listTrialClasses(teacher.id);
  const { upcoming, past } = partitionByTime(rows);

  // Resolve converted_to_user_id → students.id for scheduling
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
          Mis clases de prueba
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {upcoming.length} proxima{upcoming.length === 1 ? "" : "s"} ·{" "}
          {past.length} pasada{past.length === 1 ? "" : "s"}.
        </p>
      </header>

      {upcoming.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300 mb-3">
            Siguiente clase
          </h2>
          <TrialHubList rows={[upcoming[0]]} studentMap={studentMap} />
        </section>
      )}

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300 mb-3">
          {upcoming.length > 1 ? "Siguientes" : "Proximas"}
        </h2>
        {upcoming.length <= 1 ? (
          <EmptyState text={upcoming.length === 0 ? "No tienes clases de prueba agendadas." : "No hay mas clases agendadas despues de la siguiente."} />
        ) : (
          <TrialHubList rows={upcoming.slice(1)} studentMap={studentMap} />
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300 mb-3">
          Historial
        </h2>
        {past.length === 0 ? (
          <EmptyState text="Aun no tienes clases de prueba pasadas." />
        ) : (
          <TrialHubList rows={past} studentMap={studentMap} />
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
