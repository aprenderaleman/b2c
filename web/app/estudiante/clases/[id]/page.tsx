import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireRole } from "@/lib/rbac";
import { getStudentByUserId } from "@/lib/academy";
import { classStatusEs, formatClassDateEs, formatClassTimeEs, getClassById } from "@/lib/classes";
import { formatDurationHms, getRecordingsForClass } from "@/lib/recordings";

export const dynamic = "force-dynamic";

export default async function StudentClassDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireRole(["student", "admin", "superadmin"]);
  const { id } = await params;
  const cls = await getClassById(id);
  if (!cls) notFound();

  // Students can only see classes they're a participant of.
  if (session.user.role === "student") {
    const me = await getStudentByUserId(session.user.id);
    const amIIn = me && cls.participants.some(p => p.student_id === me.id);
    if (!amIIn) redirect("/estudiante");
  }

  const start = new Date(cls.scheduled_at);
  const end   = new Date(start.getTime() + cls.duration_minutes * 60 * 1000);
  const recordings = await getRecordingsForClass(cls.id);

  return (
    <main className="space-y-5">
      <Link href="/estudiante/clases" className="text-sm text-slate-500 dark:text-slate-400 hover:text-brand-600 dark:hover:text-brand-400">
        ← Volver a mis clases
      </Link>

      <header className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
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
      </header>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-5">
          <section className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
              Tu profesor
            </h2>
            <p className="mt-3 text-sm text-slate-800 dark:text-slate-200">
              {cls.teacher_name ?? cls.teacher_email}
            </p>
          </section>

          {cls.type === "group" && cls.participants.length > 1 && (
            <section className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                Compañeros ({cls.participants.length - 1})
              </h2>
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                (Se muestran los nombres completos sólo en clases grupales.)
              </p>
              <ul className="mt-2 divide-y divide-slate-100 dark:divide-slate-800 text-sm">
                {cls.participants.map(p => (
                  <li key={p.student_id} className="py-1.5 text-slate-700 dark:text-slate-200">
                    {p.student_name ?? p.student_email}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {cls.topic && (
            <section className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">Tema</h2>
              <p className="mt-3 text-sm text-slate-700 dark:text-slate-200 whitespace-pre-wrap">{cls.topic}</p>
            </section>
          )}
        </div>

        <div className="lg:col-span-1 space-y-5">
          <section className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
              Aula virtual
            </h2>
            {cls.status !== "cancelled" && cls.status !== "completed" ? (
              <>
                <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                  Se abre 15 minutos antes del inicio de la clase.
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
                Grabaciones
              </h2>
              <ul className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
                {recordings.map(r => (
                  <li key={r.id} className="py-2.5">
                    {r.status === "ready" ? (
                      <Link
                        href={`/grabacion/${r.id}`}
                        className="flex items-center justify-between gap-3 hover:text-brand-600 dark:hover:text-brand-400"
                      >
                        <span className="text-sm">Ver grabación</span>
                        <span className="text-xs text-slate-500 dark:text-slate-400">
                          {r.duration_seconds ? formatDurationHms(r.duration_seconds) : "—"}
                        </span>
                      </Link>
                    ) : r.status === "processing" ? (
                      <span className="text-xs text-amber-700 dark:text-amber-300">Procesando…</span>
                    ) : (
                      <span className="text-xs text-red-600 dark:text-red-400">Fallo al procesar</span>
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
