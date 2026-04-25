import { requireRoleWithImpersonation } from "@/lib/rbac";
import { getTeacherByUserId } from "@/lib/academy";
import { listTrialClasses, partitionByTime } from "@/lib/trial-classes";
import { TrialClassCard } from "@/components/TrialClassCard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Clases de prueba · Profesor" };

/**
 * Teacher view of THEIR trial classes. Same card UI as the admin page
 * but scoped to `teacher_id = <current teacher>`, and without the
 * "ver lead" link (teachers don't have access to /admin/leads).
 */
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

  return (
    <main className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">
          Mis clases de prueba
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {upcoming.length} próxima{upcoming.length === 1 ? "" : "s"} ·{" "}
          {past.length} pasada{past.length === 1 ? "" : "s"}.
        </p>
      </header>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300 mb-3">
          Próximas
        </h2>
        {upcoming.length === 0 ? (
          <EmptyState text="No tienes clases de prueba agendadas. Verifica que tu admin te haya marcado como elegible para clases de prueba." />
        ) : (
          <div className="grid gap-3">
            {upcoming.map((r) => (
              <TrialClassCard key={r.classId} row={r} />
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300 mb-3">
          Historial
        </h2>
        {past.length === 0 ? (
          <EmptyState text="Aún no tienes clases de prueba pasadas." />
        ) : (
          <div className="grid gap-3">
            {past.map((r) => (
              <TrialClassCard key={r.classId} row={r} />
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
