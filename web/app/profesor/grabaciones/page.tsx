import Link from "next/link";
import { requireRoleWithImpersonation } from "@/lib/rbac";
import { getTeacherByUserId } from "@/lib/academy";
import { getTeacherRecordings, getLeadTeacherRecordings, formatDurationHms, type LeadTeacherResult } from "@/lib/recordings";
import { formatClassDateEs, formatClassTimeEs } from "@/lib/classes";

export const dynamic = "force-dynamic";
export const metadata = { title: "Grabaciones · Aprender-Aleman.de" };

/**
 * Lista todas las grabaciones de las clases que dió el profesor.
 * Misma estructura que /estudiante/grabaciones — agrupado por mes.
 */
export default async function TeacherRecordingsPage() {
  const session = await requireRoleWithImpersonation(
    ["teacher", "admin", "superadmin"],
    "teacher",
  );
  const teacher = await getTeacherByUserId(session.user.id);
  if (!teacher) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <h1 className="text-2xl font-semibold">Grabaciones</h1>
        <p className="mt-3 text-slate-600 dark:text-slate-300">
          Tu cuenta no está asociada a un profesor. Contacta con la academia.
        </p>
      </main>
    );
  }

  const recs = await getTeacherRecordings(teacher.id);
  const trialRecs   = recs.filter(r => r.is_trial);
  const regularRecs = recs.filter(r => !r.is_trial);

  // Lead teacher sees recordings from other teachers
  const isLead = Boolean((teacher as { is_lead?: boolean }).is_lead);
  const colleagueResult: LeadTeacherResult = isLead
    ? await getLeadTeacherRecordings(teacher.id)
    : { recordings: [], teacherNames: [] };

  return (
    <main className="mx-auto max-w-4xl p-4 sm:p-6 space-y-8">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
          Mis grabaciones
        </h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          Todas las clases que diste en la plataforma y se grabaron. Útil para
          revisar la sesión, compartir un fragmento con un alumno, o estudiar
          cómo mejorar el ritmo de la clase.
        </p>
      </header>

      {recs.length === 0 && colleagueResult.recordings.length === 0 && colleagueResult.teacherNames.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 p-8 text-center">
          <div className="text-4xl">🎬</div>
          <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
            Aún no hay grabaciones disponibles. Aparecerán aquí en cuanto se procesen.
          </p>
        </div>
      )}

      {/* Lead teacher: trial recordings from other teachers (last 2 weeks) */}
      {colleagueResult.teacherNames.length > 0 && (
        <ColleagueRecordingGroup recs={colleagueResult.recordings} teacherNames={colleagueResult.teacherNames} />
      )}

      {/* Trial recordings — only the assigned teacher (and superadmin) see these. */}
      {trialRecs.length > 0 && (
        <RecordingGroup
          title="Clases de prueba"
          subtitle="Solo tú y el superadmin pueden ver estas grabaciones."
          recs={trialRecs}
          tone="trial"
        />
      )}

      {regularRecs.length > 0 && (
        <RecordingGroup
          title="Clases regulares"
          subtitle={null}
          recs={regularRecs}
          tone="regular"
        />
      )}
    </main>
  );
}

type Rec = Awaited<ReturnType<typeof getTeacherRecordings>>[number];

function RecordingGroup({ title, subtitle, recs, tone }: {
  title: string; subtitle: string | null; recs: Rec[]; tone: "trial" | "regular";
}) {
  const byMonth = new Map<string, Rec[]>();
  for (const r of recs) {
    const key = monthKeyBerlin(r.scheduled_at);
    const arr = byMonth.get(key) ?? [];
    arr.push(r);
    byMonth.set(key, arr);
  }
  const monthsDesc = [...byMonth.keys()].sort((a, b) => b.localeCompare(a));

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <h2 className={
          tone === "trial"
            ? "text-base font-bold tracking-tight text-amber-700 dark:text-amber-300"
            : "text-base font-bold tracking-tight text-slate-900 dark:text-slate-100"
        }>
          {title}
        </h2>
        <span className={
          tone === "trial"
            ? "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300"
            : "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
        }>
          {recs.length}
        </span>
      </div>
      {subtitle && (
        <p className="text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>
      )}
      {monthsDesc.map(mk => (
        <div key={mk} className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {labelForMonth(mk)}
          </h3>
          <ul className="space-y-2">
            {(byMonth.get(mk) ?? []).map(r => (
              <li key={r.id} className={
                tone === "trial"
                  ? "rounded-2xl bg-amber-50/40 dark:bg-amber-500/5 border border-amber-200 dark:border-amber-500/30 p-3 sm:p-4 shadow-sm"
                  : "rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-3 sm:p-4 shadow-sm"
              }>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-4">
                  <div className="min-w-0">
                    <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                      {tone === "trial" ? "🎯 " : ""}
                      {r.class_title}
                    </h4>
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 capitalize">
                      {formatClassDateEs(r.scheduled_at)} · {formatClassTimeEs(r.scheduled_at)}
                      {r.duration_seconds ? ` · ${formatDurationHms(r.duration_seconds)}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <StatusBadge status={r.status} />
                    {r.status === "ready" && (
                      <Link
                        href={`/grabacion/${r.id}`}
                        prefetch={false}
                        className="btn-primary text-xs whitespace-nowrap"
                      >
                        ▶ Reproducir
                      </Link>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

function StatusBadge({ status }: { status: "processing" | "ready" | "failed" | "deleted" }) {
  if (status === "ready") return null;
  const styles =
    status === "processing" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                            : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300";
  const text = status === "processing" ? "Procesando…" : "Falló";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${styles}`}>
      {text}
    </span>
  );
}

function monthKeyBerlin(iso: string): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    year: "numeric", month: "2-digit", timeZone: "Europe/Berlin",
  });
  return fmt.format(new Date(iso));
}

function labelForMonth(key: string): string {
  const [Y, M] = key.split("-").map(Number);
  const d = new Date(Date.UTC(Y, M - 1, 15));
  return d.toLocaleDateString("es-ES", { month: "long", year: "numeric", timeZone: "Europe/Berlin" })
          .replace(/^\w/, c => c.toUpperCase());
}

type ColleagueRec = LeadTeacherResult["recordings"][number];
type TeacherGroup = { name: string; recs: ColleagueRec[] };

function ColleagueRecordingGroup({ recs, teacherNames }: { recs: ColleagueRec[]; teacherNames: string[] }) {
  const byTeacher = new Map<string, ColleagueRec[]>();
  for (const name of teacherNames) byTeacher.set(name, []);
  for (const r of recs) {
    const arr = byTeacher.get(r.teacher_name) ?? [];
    arr.push(r);
    byTeacher.set(r.teacher_name, arr);
  }
  const groups: TeacherGroup[] = [...byTeacher.entries()]
    .map(([name, recs]) => ({ name, recs }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <h2 className="text-base font-bold tracking-tight text-indigo-700 dark:text-indigo-300">
          Trials del equipo
        </h2>
        <span className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide bg-indigo-100 text-indigo-800 dark:bg-indigo-500/20 dark:text-indigo-300">
          {recs.length}
        </span>
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Clases de prueba de tus colegas en las últimas 2 semanas (+30 min).
      </p>
      <div className="space-y-2">
        {groups.map(g => (
          <details key={g.name} className="group rounded-2xl border border-indigo-200 dark:border-indigo-500/30 bg-indigo-50/40 dark:bg-indigo-500/5 overflow-hidden">
            <summary className="flex items-center justify-between cursor-pointer px-4 py-3 select-none hover:bg-indigo-100/50 dark:hover:bg-indigo-500/10 transition-colors">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">{g.name}</span>
                <span className="rounded-full px-1.5 py-0.5 text-[10px] font-bold bg-indigo-200/60 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300">
                  {g.recs.length}
                </span>
              </div>
              <span className="text-indigo-400 dark:text-indigo-500 text-xs group-open:rotate-90 transition-transform">&#9654;</span>
            </summary>
            <div className="px-3 pb-3">
            {g.recs.length === 0 ? (
              <p className="text-xs text-slate-400 dark:text-slate-500 italic py-2">Sin grabaciones en las últimas 2 semanas.</p>
            ) : (
            <ul className="space-y-2">
              {g.recs.map(r => (
                <li key={r.id} className="rounded-xl bg-white/60 dark:bg-slate-900/40 border border-indigo-100 dark:border-indigo-500/20 p-3">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-4">
                    <div className="min-w-0">
                      <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                        {r.class_title}
                      </h4>
                      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 capitalize">
                        {formatClassDateEs(r.scheduled_at)} · {formatClassTimeEs(r.scheduled_at)}
                        {r.duration_seconds ? ` · ${formatDurationHms(r.duration_seconds)}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <StatusBadge status={r.status} />
                      {r.status === "ready" && (
                        <Link
                          href={`/grabacion/${r.id}`}
                          prefetch={false}
                          className="btn-primary text-xs whitespace-nowrap"
                        >
                          ▶ Reproducir
                        </Link>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            )}
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}
