import Link from "next/link";
import { requireRole } from "@/lib/rbac";
import { getStudentByUserId } from "@/lib/academy";
import { getStudentUpcomingClasses, type ClassWithPeople, classStatusEs, formatClassDateEs, formatClassTimeEs } from "@/lib/classes";
import { NextClassCard } from "@/components/classes/NextClassCard";

export const dynamic = "force-dynamic";

export default async function StudentHome() {
  const session = await requireRole(["student", "admin", "superadmin"]);
  const firstName = (session.user.name ?? session.user.email).split(/\s+/)[0];

  const student = await getStudentByUserId(session.user.id);

  if (!student) {
    return (
      <main className="space-y-6">
        <header>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">¡Hola, {firstName}! 🇩🇪</h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm">
            Tu cuenta no tiene un perfil de estudiante asociado. Contacta con el equipo.
          </p>
        </header>
        <ExternalToolsRow />
      </main>
    );
  }

  const upcoming = await getStudentUpcomingClasses(student.id, new Date(), 60);
  const [next, ...rest] = upcoming;

  return (
    <main className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">¡Hola, {firstName}! 🇩🇪</h1>
        <p className="text-slate-500 dark:text-slate-400 text-sm">
          Bienvenido a tu plataforma. Aquí está lo próximo.
        </p>
      </header>

      {next ? (
        <NextClassCard
          classId={next.id}
          title={next.title}
          scheduledAt={next.scheduled_at}
          durationMinutes={next.duration_minutes}
          participantsSummary={teacherSummary(next)}
          livekitRoomId={next.livekit_room_id}
          detailHref={`/estudiante/clases/${next.id}`}
          audience="student"
        />
      ) : (
        <EmptyNext />
      )}

      {rest.length > 0 && (
        <section className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
              Próximas clases
            </h2>
            <Link href="/estudiante/clases" className="text-xs text-brand-600 dark:text-brand-400 hover:underline">
              Ver todas →
            </Link>
          </div>
          <ul className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
            {rest.slice(0, 5).map(c => (
              <li key={c.id}>
                <Link
                  href={`/estudiante/clases/${c.id}`}
                  className="flex items-center justify-between gap-3 py-3 hover:bg-slate-50/60 dark:hover:bg-slate-800/40 -mx-2 px-2 rounded-lg transition-colors"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-slate-900 dark:text-slate-100">{c.title}</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      <span className="capitalize">{formatClassDateEs(c.scheduled_at)}</span>
                      <span className="mx-1">·</span>
                      <span className="font-mono">{formatClassTimeEs(c.scheduled_at)}</span>
                      <span className="mx-1">·</span>
                      {c.duration_minutes} min
                      <span className="mx-1">·</span>
                      {teacherSummary(c)}
                    </div>
                  </div>
                  <span className="text-xs text-slate-500 dark:text-slate-400 shrink-0">
                    {classStatusEs(c.status)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <ExternalToolsRow />

      <section className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
          Tu plan
        </h2>
        <p className="mt-3 text-sm text-slate-700 dark:text-slate-200">
          Nivel actual: <strong>{student.current_level}</strong>
          {student.subscription_type === "monthly_subscription"
            ? <> · {student.classes_per_month ?? "?"} clases/mes (suscripción mensual)</>
            : <> · {student.classes_remaining} clases restantes</>
          }
        </p>
      </section>
    </main>
  );
}

function teacherSummary(c: ClassWithPeople): string {
  return c.teacher_name ? `Con ${c.teacher_name}` : c.teacher_email;
}

function EmptyNext() {
  return (
    <section className="rounded-3xl border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 p-6 text-center">
      <div className="text-4xl" aria-hidden>📅</div>
      <p className="mt-2 text-slate-600 dark:text-slate-300 font-medium">Aún no hay clases agendadas.</p>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
        Cuando el equipo te asigne una clase, aparecerá aquí con la fecha y el botón para entrar.
      </p>
    </section>
  );
}

function ExternalToolsRow() {
  return (
    <section className="grid gap-4 sm:grid-cols-2">
      <ExternalCard
        emoji="🎓"
        title="SCHULE"
        body="Ejercicios autoevaluables, audios, gramática y vocabulario."
        href="https://schule.aprender-aleman.de"
      />
      <ExternalCard
        emoji="🤖"
        title="HANS"
        body="Tu profesor de IA 24/7 — practica conversación cuando quieras."
        href="https://hans.aprender-aleman.de"
      />
    </section>
  );
}

function ExternalCard({ emoji, title, body, href }: {
  emoji: string; title: string; body: string; href: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="rounded-3xl bg-white dark:bg-slate-900
                 border border-slate-200 dark:border-slate-800
                 p-5 block transition-all
                 hover:-translate-y-0.5 hover:shadow-brand
                 hover:border-brand-400 dark:hover:border-brand-500"
    >
      <div className="flex items-start gap-4">
        <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-50 dark:bg-brand-500/10 text-2xl" aria-hidden>{emoji}</span>
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-50">
            {title} <span aria-hidden className="text-sm font-normal text-slate-400">↗</span>
          </h3>
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">{body}</p>
        </div>
      </div>
    </a>
  );
}
