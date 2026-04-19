import Link from "next/link";
import { requireRoleWithImpersonation } from "@/lib/rbac";
import { getStudentByUserId } from "@/lib/academy";
import { getStudentHomework } from "@/lib/homework";
import { HomeworkSubmitCard } from "./HomeworkSubmitCard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Tareas · Estudiante" };

export default async function StudentHomeworkPage() {
  const session = await requireRoleWithImpersonation(
    ["student", "admin", "superadmin"],
    "student",
  );
  const student = await getStudentByUserId(session.user.id);

  if (!student) {
    return (
      <main>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Tareas</h1>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          Tu cuenta no tiene un perfil de estudiante.
        </p>
      </main>
    );
  }

  const items = await getStudentHomework(student.id);
  const pending    = items.filter(i => !i.submission || i.submission.status === "needs_revision");
  const inReview   = items.filter(i => i.submission?.status === "submitted");
  const reviewed   = items.filter(i => i.submission?.status === "reviewed");

  return (
    <main className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Mis tareas</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {pending.length} pendiente{pending.length === 1 ? "" : "s"} ·
          {" "}{inReview.length} en revisión ·
          {" "}{reviewed.length} revisada{reviewed.length === 1 ? "" : "s"}
        </p>
      </header>

      <Block title="Pendientes" empty="No tienes tareas pendientes ✨" items={pending} />
      <Block title="En revisión por el profesor" empty="Ninguna en revisión." items={inReview} />
      <Block title="Revisadas" empty="Aún no hay tareas revisadas." items={reviewed} />
    </main>
  );
}

function Block({
  title, empty, items,
}: {
  title: string;
  empty: string;
  items: Awaited<ReturnType<typeof getStudentHomework>>;
}) {
  return (
    <section className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
        {title}
      </h2>
      {items.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">{empty}</p>
      ) : (
        <div className="mt-4 space-y-4">
          {items.map(a => <HomeworkSubmitCard key={a.id} assignment={a} />)}
        </div>
      )}
    </section>
  );
}
