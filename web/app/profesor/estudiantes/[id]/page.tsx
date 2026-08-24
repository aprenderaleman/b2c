import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireRoleWithImpersonation } from "@/lib/rbac";
import { getStudentById, getTeacherByUserId } from "@/lib/academy";
import { supabaseAdmin } from "@/lib/supabase";
import { getStudentProgress, listNotesForStudent } from "@/lib/teacher-notes";
import { NotesTimeline } from "@/components/teacher/NotesTimeline";
import { ProgressBars } from "@/components/teacher/ProgressBars";
import { StartNowButton } from "./StartNowButton";
import { ScheduleButton } from "./ScheduleButton";
import { IssueCertificateButton } from "@/components/admin/IssueCertificateButton";
import { GroupDocButton } from "@/components/classes/GroupDocButton";
import { GarantiaNivelCard } from "@/components/garantia/GarantiaNivelCard";
import { getClassBalance } from "@/lib/class-balance";

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
  let teacherFullName: string | null = null;
  if (session.user.role === "teacher") {
    const me = await getTeacherByUserId(session.user.id);
    if (!me) redirect("/profesor");
    teacherFullName = me.full_name;
    const sb = supabaseAdmin();
    const [shared, groupMembership] = await Promise.all([
      sb.from("class_participants")
        .select("class_id, classes!inner(teacher_id)")
        .eq("student_id", studentId)
        .eq("classes.teacher_id", me.id)
        .limit(1),
      sb.from("student_group_members")
        .select("student_id, group:student_groups!inner(teacher_id, active)")
        .eq("student_id", studentId)
        .eq("group.teacher_id", me.id)
        .eq("group.active", true)
        .limit(1),
    ]);
    const hasClass = (shared.data?.length ?? 0) > 0;
    const hasGroup = (groupMembership.data?.length ?? 0) > 0;
    if (!hasClass && !hasGroup) redirect("/profesor");
    teacherId = me.id;
  }

  // For admins we still scope notes to the teacher they filter by, or show
  // all by default. Simplest: show all notes on this student.
  const sbBal = supabaseAdmin();
  const [progress, notes, ofertaRow] = await Promise.all([
    getStudentProgress(studentId),
    listNotesForStudent(studentId, teacherId ?? undefined),
    sbBal.from("students").select("oferta_id, clases_totales").eq("id", studentId).maybeSingle(),
  ]);

  // Balance de clases (caso Jonathan/Nancy 2026-08-20). Tras la
  // unificación 2026-08-21 aplica a todo estudiante con balance
  // inicializado (clases_totales) — pago único con todo desbloqueado,
  // suscripción con desbloqueo mensual.
  const ofData = ofertaRow.data as { oferta_id: string | null; clases_totales: number | null } | null;
  const hasBalance = !!ofData?.oferta_id || ofData?.clases_totales != null;
  const balance = hasBalance ? await getClassBalance(studentId).catch(() => null) : null;

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
              {student.phone && (
                <>
                  <span>·</span>
                  <a
                    href={`https://wa.me/${student.phone.replace(/\D/g, "")}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-brand-600 dark:text-brand-400 hover:underline"
                  >
                    {student.phone}
                  </a>
                </>
              )}
              <span>·</span>
              <span>Nivel {student.current_level}</span>
              {student.goal && <><span>·</span><span>Meta: {student.goal}</span></>}
            </div>
          </div>
          <div className="w-full sm:w-auto sm:min-w-[220px] space-y-2">
            <StartNowButton
              studentId={studentId}
              studentName={student.full_name ?? student.email}
            />
            <ScheduleButton
              studentId={studentId}
              studentName={student.full_name ?? student.email}
            />
            {student.classes_remaining === 0 && (
              <IssueCertificateButton
                studentId={studentId}
                teacherName={teacherFullName ?? undefined}
              />
            )}
          </div>
        </div>
      </header>

      {student.document_url && (
        <div className="flex">
          <GroupDocButton documentUrl={student.document_url} label="Apuntes de clase" />
        </div>
      )}

      {balance && (
        <section className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
            Balance de clases
          </h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {balance.classesPerMonth
              ? `Plan: ${balance.classesPerMonth} clases/mes. Solo se pueden agendar hasta ${balance.classesPerMonth} por ciclo.`
              : "La suscripción desbloquea clases cada mes con el cobro."}
          </p>
          <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
            <div className="rounded-xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30 p-3">
              <div className="text-2xl font-bold tabular-nums text-emerald-700 dark:text-emerald-300">{balance.disponibles}</div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700/80 dark:text-emerald-300/80">Agendables ahora</div>
            </div>
            <div className="rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-3">
              <div className="text-2xl font-bold tabular-nums text-slate-700 dark:text-slate-200">{balance.agendadas}</div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Ya agendadas</div>
            </div>
            <div className="rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-3">
              <div className="text-2xl font-bold tabular-nums text-slate-700 dark:text-slate-200">{balance.consumidas}</div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Tomadas</div>
            </div>
            <div className="rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-3">
              <div className="text-2xl font-bold tabular-nums text-slate-700 dark:text-slate-200">
                {balance.total != null ? balance.total - balance.consumidas : "—"}
              </div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Restantes del pack</div>
            </div>
          </div>
        </section>
      )}

      <GarantiaNivelCard
        attendanceRate={student.attendance_rate}
        schuleCompletionPct={student.schule_completion_pct}
        status={(student.garantia_status as "active" | "at_risk" | "lost" | "not_applicable") ?? "not_applicable"}
      />

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
