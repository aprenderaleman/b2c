import Link from "next/link";
import { requireRole } from "@/lib/rbac";
import { getTeacherByUserId } from "@/lib/academy";
import { getTeacherUpcomingClasses, type ClassWithPeople, classStatusEs, formatClassDateEs, formatClassTimeEs } from "@/lib/classes";
import { NextClassCard } from "@/components/classes/NextClassCard";

export const dynamic = "force-dynamic";

export default async function TeacherHome() {
  const session = await requireRole(["teacher", "admin", "superadmin"]);
  const firstName = (session.user.name ?? session.user.email).split(/\s+/)[0];

  const teacher = await getTeacherByUserId(session.user.id);

  if (!teacher) {
    // Admin / superadmin can land on /profesor for a quick look — show
    // a friendly empty state instead of crashing the query.
    return (
      <main className="space-y-6">
        <header>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Hola, {firstName} 👋</h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm">
            Esta es la zona de profesor. Tu cuenta no tiene un perfil de profesor asociado —
            pide al admin que te añada como profesor en{" "}
            <Link href="/admin/profesores/nuevo" className="text-brand-600 dark:text-brand-400 underline-offset-4 hover:underline">
              Profesores → Nuevo
            </Link>.
          </p>
        </header>
      </main>
    );
  }

  const all = await getTeacherUpcomingClasses(teacher.id, new Date(), 30);
  const [next, ...rest] = all;

  const todayEnd = endOfTodayBerlin();
  const weekEnd  = endOfThisWeek();
  const todayClasses = rest.filter(c => new Date(c.scheduled_at) <= todayEnd);
  const thisWeek     = rest.filter(c => {
    const t = new Date(c.scheduled_at);
    return t > todayEnd && t <= weekEnd;
  });
  const later        = rest.filter(c => new Date(c.scheduled_at) > weekEnd);

  return (
    <main className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">
          Hola, {firstName} 👋
        </h1>
        <p className="text-slate-500 dark:text-slate-400 text-sm">
          Esto es lo que tienes agendado.
        </p>
      </header>

      {next ? (
        <NextClassCard
          classId={next.id}
          title={next.title}
          scheduledAt={next.scheduled_at}
          durationMinutes={next.duration_minutes}
          participantsSummary={summariseParticipants(next)}
          livekitRoomId={next.livekit_room_id}
          detailHref={`/profesor/clases/${next.id}`}
          audience="teacher"
        />
      ) : (
        <EmptyNext />
      )}

      <DayGroup title="Hoy" classes={todayClasses} />
      <DayGroup title="Esta semana" classes={thisWeek} />
      <DayGroup title="Más adelante" classes={later} />

      <section className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
              Disponibilidad
            </h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Marca tus horas disponibles para que el admin sepa cuándo agendarte.
            </p>
          </div>
          <Link href="/profesor/disponibilidad" className="btn-secondary text-xs">
            Editar →
          </Link>
        </div>
      </section>
    </main>
  );
}

function DayGroup({ title, classes }: { title: string; classes: ClassWithPeople[] }) {
  if (classes.length === 0) return null;
  return (
    <section className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
        {title}
      </h2>
      <ul className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
        {classes.map(c => (
          <li key={c.id}>
            <Link
              href={`/profesor/clases/${c.id}`}
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
                  {summariseParticipants(c)}
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
  );
}

function EmptyNext() {
  return (
    <section className="rounded-3xl border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 p-6 text-center">
      <div className="text-4xl" aria-hidden>📅</div>
      <p className="mt-2 text-slate-600 dark:text-slate-300 font-medium">No tienes clases agendadas.</p>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
        Cuando el admin te asigne una clase aparecerá aquí.
      </p>
    </section>
  );
}

function summariseParticipants(c: ClassWithPeople): string {
  if (c.participants.length === 1) {
    const p = c.participants[0];
    return `Con ${p.student_name ?? p.student_email}`;
  }
  return `${c.participants.length} estudiantes`;
}

function endOfTodayBerlin(): Date {
  // Approximate: today 23:59:59 in the user's local time.
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
}
function endOfThisWeek(): Date {
  const d = new Date();
  const day = d.getDay();                  // 0=Sun … 6=Sat
  const daysUntilSunday = (7 - day) % 7;
  d.setDate(d.getDate() + daysUntilSunday);
  d.setHours(23, 59, 59, 999);
  return d;
}
