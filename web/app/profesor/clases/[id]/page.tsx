import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireRole } from "@/lib/rbac";
import { getTeacherByUserId } from "@/lib/academy";
import { classStatusEs, formatClassDateEs, formatClassTimeEs, getClassById } from "@/lib/classes";
import { EndClassModal } from "@/components/classes/EndClassModal";
import { formatDurationHms, getRecordingsForClass } from "@/lib/recordings";
import { getClassHomework } from "@/lib/homework";
import { HomeworkSection } from "@/components/homework/HomeworkSection";
import { AttendanceEditor } from "@/components/classes/AttendanceEditor";

export const dynamic = "force-dynamic";

export default async function TeacherClassDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireRole(["teacher", "admin", "superadmin"]);
  const { id } = await params;

  const cls = await getClassById(id);
  if (!cls) notFound();

  // Teachers can only see their own classes. Admins/superadmins can see any.
  if (session.user.role === "teacher") {
    const me = await getTeacherByUserId(session.user.id);
    if (!me || me.id !== cls.teacher_id) redirect("/profesor");
  }

  const start = new Date(cls.scheduled_at);
  const end   = new Date(start.getTime() + cls.duration_minutes * 60 * 1000);
  const recordings = await getRecordingsForClass(cls.id);
  const homework   = await getClassHomework(cls.id);

  // Suggest a duration for the end-class modal: real elapsed time from
  // started_at to now, clamped to the originally scheduled duration × 1.5
  // to avoid accidental 48h classes if the teacher forgot to end.
  const startedMs = cls.started_at ? new Date(cls.started_at).getTime() : Date.now();
  const elapsedMin = Math.max(1, Math.round((Date.now() - startedMs) / 60000));
  const suggested  = Math.min(cls.duration_minutes * 2, elapsedMin);

  return (
    <main className="space-y-5">
      <Link href="/profesor" className="text-sm text-slate-500 dark:text-slate-400 hover:text-brand-600 dark:hover:text-brand-400">
        ← Volver a mi inicio
      </Link>

      {/* Opens when teacher returns from /aula/[id] with ?end=1 */}
      {cls.status !== "completed" && (
        <EndClassModal
          classId={cls.id}
          suggestedMinutes={suggested}
          scheduledDuration={cls.duration_minutes}
        />
      )}

      <header className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">{cls.title}</h1>
          <div className="mt-1 flex items-center gap-3 text-sm text-slate-600 dark:text-slate-300 flex-wrap">
            <span className="capitalize">{formatClassDateEs(start)}</span>
            <span>·</span>
            <span className="font-mono">
              {formatClassTimeEs(start)}–{formatClassTimeEs(end)} (Berlín)
            </span>
            <span>·</span>
            <span>{cls.duration_minutes} min</span>
            <span>·</span>
            <span>{cls.type === "individual" ? "Individual" : "Grupo"}</span>
            <span>·</span>
            <span className="text-xs text-slate-500 dark:text-slate-400">{classStatusEs(cls.status)}</span>
          </div>
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-5">
          <section className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
              Estudiantes ({cls.participants.length})
              {(cls.status === "completed" || cls.status === "live" || cls.status === "absent") && (
                <span className="ml-2 text-[10px] font-medium normal-case tracking-normal text-brand-600 dark:text-brand-400">
                  · marca la asistencia
                </span>
              )}
            </h2>

            {(cls.status === "completed" || cls.status === "live" || cls.status === "absent") ? (
              <div className="mt-3">
                <AttendanceEditor
                  classId={cls.id}
                  participants={cls.participants.map(p => ({
                    student_id:    p.student_id,
                    student_name:  p.student_name,
                    student_email: p.student_email,
                    attended:      p.attended,
                  }))}
                />
              </div>
            ) : (
              <ul className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
                {cls.participants.map(p => (
                  <li key={p.student_id} className="py-2.5 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
                        {p.student_name ?? p.student_email}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                        {p.student_email}
                      </div>
                    </div>
                    {p.student_phone && (
                      <a
                        href={`https://wa.me/${p.student_phone.replace(/\D/g, "")}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-medium rounded-full border border-[#25D366]/30 bg-[#25D366]/10 px-3 py-1 text-[#128c7e] hover:bg-[#25D366]/20 dark:text-[#25D366]"
                      >
                        WhatsApp →
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {cls.topic && (
            <section className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">Tema</h2>
              <p className="mt-3 text-sm text-slate-700 dark:text-slate-200 whitespace-pre-wrap">{cls.topic}</p>
            </section>
          )}

          <HomeworkSection classId={cls.id} assignments={homework} />
        </div>

        <div className="lg:col-span-1 space-y-5">
          <section className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
              Aula virtual
            </h2>
            {cls.status !== "cancelled" && cls.status !== "completed" ? (
              <>
                <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                  Se abre 15 min antes del inicio y se cierra 30 min después del fin.
                </p>
                <Link
                  href={`/aula/${cls.id}`}
                  className="btn-primary mt-4 inline-flex text-sm"
                >
                  Entrar al aula →
                </Link>
              </>
            ) : (
              <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                El aula para esta clase ya no está disponible.
              </p>
            )}
          </section>

          {recordings.length > 0 && (
            <section className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                Grabaciones ({recordings.length})
              </h2>
              <ul className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
                {recordings.map(r => (
                  <li key={r.id} className="py-2.5">
                    {r.status === "ready" ? (
                      <Link
                        href={`/grabacion/${r.id}`}
                        className="flex items-center justify-between gap-3 hover:text-brand-600 dark:hover:text-brand-400"
                      >
                        <span className="text-sm">
                          {new Date(r.created_at).toLocaleDateString("es-ES")}
                        </span>
                        <span className="text-xs text-slate-500 dark:text-slate-400">
                          {r.duration_seconds ? formatDurationHms(r.duration_seconds) : "—"}
                        </span>
                      </Link>
                    ) : r.status === "processing" ? (
                      <span className="text-xs text-amber-700 dark:text-amber-300">Procesando…</span>
                    ) : (
                      <span className="text-xs text-red-600 dark:text-red-400">Falló</span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </main>
  );
}
