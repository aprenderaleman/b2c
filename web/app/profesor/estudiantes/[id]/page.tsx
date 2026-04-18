import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireRole } from "@/lib/rbac";
import { getStudentById, getTeacherByUserId } from "@/lib/academy";
import { supabaseAdmin } from "@/lib/supabase";
import { getStudentProgress, listNotesForStudent } from "@/lib/teacher-notes";
import { NotesTimeline } from "@/components/teacher/NotesTimeline";
import { ProgressBars } from "@/components/teacher/ProgressBars";

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
  const session = await requireRole(["teacher", "admin", "superadmin"]);
  const { id: studentId } = await params;

  const student = await getStudentById(studentId);
  if (!student) notFound();

  // Teacher-gate: they must teach this student.
  let teacherId: string | null = null;
  if (session.user.role === "teacher") {
    const me = await getTeacherByUserId(session.user.id);
    if (!me) redirect("/profesor");
    const sb = supabaseAdmin();
    const { data: shared } = await sb
      .from("class_participants")
      .select("class_id, classes!inner(teacher_id)")
      .eq("student_id", studentId)
      .eq("classes.teacher_id", me.id)
      .limit(1);
    if (!shared || shared.length === 0) redirect("/profesor");
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
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">
          {student.full_name ?? "Estudiante sin nombre"}
        </h1>
        <div className="mt-1 flex items-center gap-3 text-sm text-slate-600 dark:text-slate-300 flex-wrap">
          <span className="font-mono">{student.email}</span>
          <span>·</span>
          <span>Nivel {student.current_level}</span>
          {student.goal && <><span>·</span><span>Meta: {student.goal}</span></>}
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
