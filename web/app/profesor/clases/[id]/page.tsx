import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireRole } from "@/lib/rbac";
import { getTeacherByUserId } from "@/lib/academy";
import { classStatusEs, formatClassDateEs, formatClassTimeEs, getClassById } from "@/lib/classes";

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

  return (
    <main className="space-y-5">
      <Link href="/profesor" className="text-sm text-slate-500 dark:text-slate-400 hover:text-brand-600 dark:hover:text-brand-400">
        ← Volver a mi inicio
      </Link>

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
            </h2>
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
          </section>

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
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              El aula estará disponible 15 min antes del inicio (Fase 3).
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
