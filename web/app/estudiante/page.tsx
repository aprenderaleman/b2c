import Link from "next/link";
import { requireRoleWithImpersonation } from "@/lib/rbac";
import { getStudentByUserId } from "@/lib/academy";
import { getUserIcalToken, icalUrlFor } from "@/lib/user-extras";
import { CalendarSyncButton } from "@/components/calendar/CalendarSyncButton";
import { getAttendanceStreakForStudent } from "@/lib/attendance-streak";
import { AttendanceStreakCard } from "@/components/classes/AttendanceStreakCard";
import { OpenSchuleButton } from "@/components/entitlements/OpenSchuleButton";
// Hans temporalmente fuera de servicio (2026-04-30). Cuando vuelva:
//   import { OpenHansButton } from "@/components/entitlements/OpenHansButton";
import { getStudentUpcomingClasses, type ClassWithPeople, classStatusEs, formatClassDateEs, formatClassTimeEs } from "@/lib/classes";
import { NextClassCard } from "@/components/classes/NextClassCard";
import { LiveClassCta } from "@/components/classes/LiveClassCta";
import { getLiveClassForStudent } from "@/lib/imminent-class";
import { getStudentProgress } from "@/lib/teacher-notes";
import { ProgressBars } from "@/components/teacher/ProgressBars";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function StudentHome() {
  const session = await requireRoleWithImpersonation(
    ["student", "admin", "superadmin"],
    "student",
  );
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

  const [upcoming, progress, icalToken, streak, live] = await Promise.all([
    getStudentUpcomingClasses(student.id, new Date(), 60),
    getStudentProgress(student.id),
    getUserIcalToken(session.user.id),
    getAttendanceStreakForStudent(student.id),
    getLiveClassForStudent(student.id),
  ]);
  const [next, ...rest] = upcoming;

  return (
    <main className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">¡Hola, {firstName}! 🇩🇪</h1>
        <p className="text-slate-500 dark:text-slate-400 text-sm">
          Bienvenido a tu plataforma. Aquí está lo próximo.
        </p>
      </header>

      {/* Live-now CTA — auto-polls every 15s, auto-hides when class ends */}
      <LiveClassCta initial={live} />

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

      {/* SCHULE + HANS — above the fold, before the streak and the class list */}
      <ExternalToolsRow />

      <AttendanceStreakCard current={streak.current} best={streak.best} />

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

      <RecentClassesSection studentId={student.id} />

      <section className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
          Tu progreso
        </h2>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          Tus profesores actualizan estas puntuaciones tras cada bloque de trabajo.
        </p>
        <div className="mt-4">
          <ProgressBars studentId={student.id} scores={progress} editable={false} />
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
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
          </div>
          {icalToken && <CalendarSyncButton icalUrl={icalUrlFor(icalToken)} />}
        </div>
      </section>
    </main>
  );
}

function teacherSummary(c: ClassWithPeople): string {
  return c.teacher_name ? `Con ${c.teacher_name}` : c.teacher_email;
}


/**
 * Sección "Historial reciente" en la home del estudiante.
 *
 * Veronica reportó 2026-04-30 que un alumno suyo "no puede ver el histórico
 * de clases". El alumno solo miraba la home y no encontraba el link.
 * Ahora mostramos las últimas 5 clases asistidas en la home + un link
 * destacado a /estudiante/clases para ver TODAS.
 *
 * Si el estudiante no tiene historial todavía, mostramos un mensaje
 * amigable y el link igualmente.
 */
async function RecentClassesSection({ studentId }: { studentId: string }) {
  const sb = supabaseAdmin();
  const now = new Date().toISOString();

  const { data } = await sb
    .from("class_participants")
    .select(`
      attended,
      class:classes!inner(
        id, scheduled_at, duration_minutes, title, type, status,
        teacher:teachers(users(full_name, email))
      )
    `)
    .eq("student_id", studentId)
    .lt("class.scheduled_at", now)
    .order("class(scheduled_at)", { ascending: false })
    .limit(5);

  type Row = {
    id: string; scheduled_at: string; duration_minutes: number;
    title: string; type: string; status: string;
    teacher_name: string | null; attended: boolean | null;
  };
  const rows: Row[] = (data ?? []).flatMap(r => {
    const c = (r as { class: unknown }).class;
    const cFlat = (Array.isArray(c) ? c[0] : c) as Record<string, unknown> | undefined;
    if (!cFlat) return [];
    const t = cFlat.teacher as Record<string, unknown>[] | Record<string, unknown> | undefined;
    const tFlat = (Array.isArray(t) ? t[0] : t) as Record<string, unknown> | undefined;
    const tu = tFlat?.users as Record<string, unknown>[] | Record<string, unknown> | undefined;
    const tuFlat = (Array.isArray(tu) ? tu[0] : tu) as { full_name?: string | null; email?: string } | undefined;
    return [{
      id:               cFlat.id as string,
      scheduled_at:     cFlat.scheduled_at as string,
      duration_minutes: cFlat.duration_minutes as number,
      title:            cFlat.title as string,
      type:             cFlat.type as string,
      status:           cFlat.status as string,
      teacher_name:     tuFlat?.full_name ?? null,
      attended:         ((r as { attended: boolean | null }).attended) ?? null,
    }];
  });

  return (
    <section className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
          Clases anteriores
        </h2>
        <Link href="/estudiante/clases" className="text-xs text-brand-600 dark:text-brand-400 hover:underline">
          Ver historial completo →
        </Link>
      </div>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
          Aún no tienes clases en tu historial. Cuando completes tu primera clase, aparecerá aquí.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
          {rows.map(c => (
            <li key={c.id}>
              <Link
                href={`/estudiante/clases/${c.id}`}
                className="flex items-center justify-between gap-3 py-3 hover:bg-slate-50/60 dark:hover:bg-slate-800/40 -mx-2 px-2 rounded-lg transition-colors"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">{c.title}</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    <span className="capitalize">{formatClassDateEs(c.scheduled_at)}</span>
                    <span className="mx-1">·</span>
                    <span className="font-mono">{formatClassTimeEs(c.scheduled_at)}</span>
                    {c.teacher_name && <><span className="mx-1">·</span>Con {c.teacher_name}</>}
                  </div>
                </div>
                <span className="text-xs shrink-0">
                  {c.attended === true ? (
                    <span className="text-emerald-700 dark:text-emerald-300">✓ Asistida</span>
                  ) : c.attended === false ? (
                    <span className="text-amber-700 dark:text-amber-300">No asistida</span>
                  ) : (
                    <span className="text-slate-500 dark:text-slate-400">{classStatusEs(c.status as Parameters<typeof classStatusEs>[0])}</span>
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
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
  // Mientras Hans esté fuera de servicio, solo se muestra SCHULE en
  // ancho completo. Cuando Hans vuelva, restaurar el grid sm:grid-cols-2
  // y volver a montar <OpenHansButton /> debajo de <OpenSchuleButton />.
  return (
    <section className="grid gap-4">
      <OpenSchuleButton />
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
