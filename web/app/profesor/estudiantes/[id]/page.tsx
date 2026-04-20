import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireRoleWithImpersonation } from "@/lib/rbac";
import { getStudentById, getTeacherByUserId } from "@/lib/academy";
import { supabaseAdmin } from "@/lib/supabase";
import { getStudentProgress, listNotesForStudent } from "@/lib/teacher-notes";
import { NotesTimeline } from "@/components/teacher/NotesTimeline";
import { ProgressBars } from "@/components/teacher/ProgressBars";
import { StartNowButton } from "./StartNowButton";

export const dynamic = "force-dynamic";

/**
 * Teacher's view of ONE of their students. They can see: basic info,
 * progress bars (editable), their private notes timeline (write + read).
 * The teacher can only open this if they actually teach the student.
 */
export default async function TeacherStudentDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireRoleWithImpersonation(
    ["teacher", "admin", "superadmin"],
    "teacher",
  );
  const { id: studentId } = await params;

  const student = await getStudentById(studentId);
  if (!student) notFound();

  // Teacher-gate: they must teach this student — through either an
  // existing class OR a student_group they're the assigned teacher of.
  // The group path is important for brand-new student-teacher pairings
  // (no classes yet), which is exactly the case "iniciar clase ahora"
  // exists for.
  let teacherId: string | null = null;
  if (session.user.role === "teacher") {
    const me = await getTeacherByUserId(session.user.id);
    if (!me) redirect("/profesor");
    const sb = supabaseAdmin();
    const [shared, groupMembership] = await Promise.all([
      sb.from("class_participants")
        .select("class_id, classes!inner(teacher_id)")
        .eq("student_id", studentId)
        .eq("classes.teacher_id", me.id)
        .limit(1),
      sb.from("student_group_members")
        .select("student_id, group:student_groups!inner(teacher_id)")
        .eq("student_id", studentId)
        .eq("group.teacher_id", me.id)
        .limit(1),
    ]);
    const hasClass = (shared.data?.length ?? 0) > 0;
    const hasGroup = (groupMembership.data?.length ?? 0) > 0;
    if (!hasClass && !hasGroup) redirect("/profesor");
    teacherId = me.id;
  }

  // For admins we still scope notes to the teacher they filter by, or show
  // all by default. Simplest: show all notes on this student.
  const [progress, notes] = await Promise.all([
    getStudentProgress(studentId),
    listNotesForStudent(studentId, teacherId ?? undefined),
  ]);

  return (
    <main className="space-y-5">
      <Link href="/profesor" className="text-sm text-slate-500 dark:text-slate-400 hover:text-brand-600 dark:hover:text-brand-400">
        ← Volver al inicio
      </Link>

      <header className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">
              {student.full_name ?? "Estudiante sin nombre"}
            </h1>
            <div className="mt-1 flex items-center gap-3 text-sm text-slate-600 dark:text-slate-300 flex-wrap">
              <span className="font-mono">{student.email}</span>
              <span>·</span>
              <span>Nivel {student.current_level}</span>
              {student.goal && <><span>·</span><span>Meta: {student.goal}</span></>}
            </div>
          </div>
          <div className="w-full sm:w-auto sm:min-w-[220px]">
            <StartNowButton
              studentId={studentId}
              studentName={student.full_name ?? student.email}
            />
          </div>
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
            Progreso por destreza
          </h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Actualiza la puntuación tras cada bloque de trabajo. El estudiante
            lo ve en su panel.
          </p>
          <div className="mt-3">
            <ProgressBars studentId={studentId} scores={progress} editable />
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
            Notas privadas
          </h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Solo tú (y los admins) las ven. El estudiante no las ve.
          </p>
          <div className="mt-3">
            <NotesTimeline studentId={studentId} classId={null} notes={notes} />
          </div>
        </section>
      </div>
    </main>
  );
}
