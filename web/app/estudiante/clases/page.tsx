import Link from "next/link";
import { requireRole } from "@/lib/rbac";
import { getStudentByUserId } from "@/lib/academy";
import { supabaseAdmin } from "@/lib/supabase";
import { classStatusEs, formatClassDateEs, formatClassTimeEs } from "@/lib/classes";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mis clases · Aprender-Aleman.de" };

/**
 * Full historic + upcoming list for a student. We load 1 year back and
 * 6 months forward in one go — adequate for today's volume. Pagination
 * lands in Phase 6 when/if someone has >500 classes.
 */
export default async function StudentClassesPage() {
  const session = await requireRole(["student", "admin", "superadmin"]);
  const student = await getStudentByUserId(session.user.id);

  if (!student) {
    return (
      <main>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Mis clases</h1>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          Tu cuenta no tiene un perfil de estudiante.
        </p>
      </main>
    );
  }

  const sb = supabaseAdmin();
  const now    = new Date();
  const oneYearAgo   = new Date(now.getTime() - 365 * 24 * 3600 * 1000);
  const sixMonthsFwd = new Date(now.getTime() + 180 * 24 * 3600 * 1000);

  const { data, error } = await sb
    .from("class_participants")
    .select(`
      attended,
      class:classes!inner(
        id, scheduled_at, duration_minutes, title, type, status,
        teacher:teachers!inner(
          users!inner(email, full_name)
        )
      )
    `)
    .eq("student_id", student.id)
    .gte("class.scheduled_at", oneYearAgo.toISOString())
    .lte("class.scheduled_at", sixMonthsFwd.toISOString());
  if (error) throw error;

  type Row = {
    id: string; scheduled_at: string; duration_minutes: number;
    title: string; type: string; status: string;
    teacher_name: string | null; attended: boolean | null;
  };
  const flattened: Row[] = (data ?? []).flatMap(r => {
    const c = r.class as Record<string, unknown>[] | Record<string, unknown>;
    const cFlat = (Array.isArray(c) ? c[0] : c);
    if (!cFlat) return [];
    const t = cFlat.teacher as Record<string, unknown>[] | Record<string, unknown>;
    const tFlat = (Array.isArray(t) ? t[0] : t);
    const tu = tFlat?.users as Record<string, unknown>[] | Record<string, unknown>;
    const tuFlat = (Array.isArray(tu) ? tu[0] : tu);
    return [{
      id:               cFlat.id as string,
      scheduled_at:     cFlat.scheduled_at as string,
      duration_minutes: cFlat.duration_minutes as number,
      title:            cFlat.title as string,
      type:             cFlat.type as string,
      status:           cFlat.status as string,
      teacher_name:     (tuFlat?.full_name as string | null) ?? null,
      attended:         (r.attended as boolean | null) ?? null,
    }];
  });

  const upcoming = flattened
    .filter(r => new Date(r.scheduled_at).getTime() >= now.getTime())
    .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
  const past = flattened
    .filter(r => new Date(r.scheduled_at).getTime() < now.getTime())
    .sort((a, b) => b.scheduled_at.localeCompare(a.scheduled_at));

  return (
    <main className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Mis clases</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {upcoming.length} próxima{upcoming.length === 1 ? "" : "s"} · {past.length} en el histórico
        </p>
      </header>

      <Block title="Próximas" rows={upcoming} empty="No tienes clases agendadas." />
      <Block title="Historial" rows={past}    empty="Aún no hay clases en tu histórico." />
    </main>
  );
}

function Block({
  title, rows, empty,
}: {
  title: string;
  rows: Array<{
    id: string; scheduled_at: string; duration_minutes: number;
    title: string; type: string; status: string;
    teacher_name: string | null; attended: boolean | null;
  }>;
  empty: string;
}) {
  return (
    <section className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
        {title}
      </h2>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">{empty}</p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
          {rows.map(c => (
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
                    {c.teacher_name && <><span className="mx-1">·</span>Con {c.teacher_name}</>}
                  </div>
                </div>
                <span className="text-xs text-slate-500 dark:text-slate-400 shrink-0">
                  {classStatusEs(c.status as Parameters<typeof classStatusEs>[0])}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
