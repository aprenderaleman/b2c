import Link from "next/link";
import { notFound } from "next/navigation";
import { classStatusEs, formatClassDateEs, formatClassTimeEs, getClassById } from "@/lib/classes";
import { CancelClassButton } from "./CancelClassButton";
import { EditClassButton } from "./EditClassButton";
import { AttendanceEditor } from "@/components/classes/AttendanceEditor";

export const dynamic = "force-dynamic";

export default async function ClassDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const cls = await getClassById(id);
  if (!cls) notFound();

  const start = new Date(cls.scheduled_at);
  const end   = new Date(start.getTime() + cls.duration_minutes * 60 * 1000);

  return (
    <main className="space-y-5">
      <Link href="/admin/clases" className="text-sm text-slate-500 dark:text-slate-400 hover:text-brand-600 dark:hover:text-brand-400">
        ← Volver a clases
      </Link>

      <header className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
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
              <StatusPill status={cls.status} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            {cls.status === "scheduled" && (
              <>
                <EditClassButton
                  classId={cls.id}
                  title={cls.title}
                  topic={cls.topic ?? null}
                  scheduledAt={cls.scheduled_at}
                  durationMinutes={cls.duration_minutes}
                  hasSeries={Boolean(cls.parent_class_id)}
                />
                <CancelClassButton classId={cls.id} isSeries={Boolean(cls.parent_class_id) && cls.parent_class_id !== cls.id} />
              </>
            )}
          </div>
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-1 space-y-5">
          <Panel title="Profesor">
            <p className="text-sm text-slate-800 dark:text-slate-200">
              {cls.teacher_name ?? "—"}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 font-mono mt-0.5">{cls.teacher_email}</p>
          </Panel>

          <Panel title="Recurrencia">
            <Kv k="Patrón" v={
              cls.recurrence_pattern === "none"     ? "Clase única" :
              cls.recurrence_pattern === "weekly"   ? "Semanal"   :
              cls.recurrence_pattern === "biweekly" ? "Quincenal" : "Mensual"
            } />
            {cls.recurrence_end_date && (
              <Kv k="Hasta" v={new Date(cls.recurrence_end_date).toLocaleDateString("es-ES")} />
            )}
          </Panel>

          <Panel title="Aula virtual">
            <Kv k="Sala LiveKit" v={cls.livekit_room_id} />
            <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
              El aula abrirá 15 min antes del inicio (disponible en Fase 3).
            </p>
          </Panel>
        </div>

        <div className="lg:col-span-2 space-y-5">
          <Panel title={`Estudiantes (${cls.participants.length})`}>
            {(cls.status === "completed" || cls.status === "live" || cls.status === "absent") ? (
              <AttendanceEditor
                classId={cls.id}
                participants={cls.participants.map(p => ({
                  student_id:    p.student_id,
                  student_name:  p.student_name,
                  student_email: p.student_email,
                  attended:      p.attended,
                }))}
              />
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {cls.participants.map(p => (
                  <li key={p.student_id} className="py-2 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm text-slate-900 dark:text-slate-100">
                        {p.student_name ?? p.student_email}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                        {p.student_email}
                      </div>
                    </div>
                    <span className="text-xs text-slate-400">Se marcará cuando la clase termine</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {cls.topic && (
            <Panel title="Tema">
              <p className="text-sm text-slate-700 dark:text-slate-200 whitespace-pre-wrap">{cls.topic}</p>
            </Panel>
          )}

          {cls.notes_admin && (
            <Panel title="Notas internas (solo admin)">
              <p className="text-sm text-slate-700 dark:text-slate-200 whitespace-pre-wrap">{cls.notes_admin}</p>
            </Panel>
          )}
        </div>
      </div>
    </main>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
        {title}
      </h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Kv({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1 text-sm">
      <span className="text-slate-500 dark:text-slate-400">{k}</span>
      <span className="text-slate-900 dark:text-slate-100 text-right break-all">{v}</span>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const cls =
    status === "scheduled" ? "bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-500/30" :
    status === "live"      ? "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30" :
    status === "completed" ? "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700" :
    status === "cancelled" ? "bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 border-red-200 dark:border-red-500/30" :
                             "bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-500/30";
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${cls}`}>
      {classStatusEs(status as Parameters<typeof classStatusEs>[0])}
    </span>
  );
}
