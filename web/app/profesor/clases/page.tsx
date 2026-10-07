import Link from "next/link";
import { requireRoleWithImpersonation } from "@/lib/rbac";
import { getTeacherByUserId } from "@/lib/academy";
import { supabaseAdmin } from "@/lib/supabase";
import { classStatusEs, formatClassDateEs, formatClassTimeEs } from "@/lib/classes";
import { NewClassButton } from "./NewClassButton";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mis clases · Profesor" };

/**
 * Full class list for a teacher — upcoming + historic, grouped in two
 * blocks. Same window as the student view (1y back, 6mo forward).
 */
export default async function TeacherClassesPage({
  searchParams,
}: {
  searchParams: Promise<{ canceladas?: string; q?: string }>;
}) {
  // Las canceladas se ocultan por defecto: a Simon le salían 177 canceladas
  // (series de Flora, horarios antiguos) frente a 149 reales. ?canceladas=1
  // las vuelve a mostrar.
  const sp = await searchParams;
  const showCancelled = sp?.canceladas === "1";
  // Buscador por alumno (petición Gelfis 2026-10-07): filtra por nombre o
  // email del alumno y por título de la clase, sin acentos ni mayúsculas.
  const q = (sp?.q ?? "").trim();
  const norm = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const qn = norm(q);
  const session = await requireRoleWithImpersonation(
    ["teacher", "admin", "superadmin"],
    "teacher",
  );
  const teacher = await getTeacherByUserId(session.user.id);

  if (!teacher) {
    return (
      <main>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Mis clases</h1>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          Tu cuenta no tiene un perfil de profesor asociado.
        </p>
      </main>
    );
  }

  const sb = supabaseAdmin();
  const now           = new Date();
  const oneYearAgo    = new Date(now.getTime() - 365 * 24 * 3600 * 1000);
  const sixMonthsFwd  = new Date(now.getTime() + 180 * 24 * 3600 * 1000);

  const { data, error } = await sb
    .from("classes")
    .select(`
      id, scheduled_at, duration_minutes, title, type, status, billed_hours,
      actual_duration_minutes,
      class_participants(
        student_id, attended,
        student:students!inner(
          users!inner(full_name, email)
        )
      )
    `)
    .eq("teacher_id", teacher.id)
    .gte("scheduled_at", oneYearAgo.toISOString())
    .lte("scheduled_at", sixMonthsFwd.toISOString())
    .order("scheduled_at", { ascending: true });
  if (error) throw error;

  type StudentBits = { full_name: string | null; email: string };
  type Row = {
    id: string; scheduled_at: string; duration_minutes: number;
    title: string; type: string; status: string;
    billed_hours: number; actual_duration_minutes: number | null;
    students: StudentBits[];
  };

  const rows: Row[] = (data ?? []).map(r => {
    const parts = (r as { class_participants: Array<{ student: unknown }> }).class_participants ?? [];
    const students = parts.flatMap(p => {
      const s  = p.student as Record<string, unknown>[] | Record<string, unknown>;
      const sf = (Array.isArray(s) ? s[0] : s);
      const u  = sf?.users as Record<string, unknown>[] | Record<string, unknown>;
      const uf = (Array.isArray(u) ? u[0] : u);
      if (!uf) return [];
      return [{ full_name: (uf.full_name as string | null) ?? null, email: uf.email as string }];
    });
    return {
      id:                      r.id as string,
      scheduled_at:            r.scheduled_at as string,
      duration_minutes:        r.duration_minutes as number,
      title:                   r.title as string,
      type:                    r.type as string,
      status:                  r.status as string,
      billed_hours:            (r.billed_hours as number) ?? 0,
      actual_duration_minutes: (r.actual_duration_minutes as number | null) ?? null,
      students,
    };
  });

  const cancelledCount = rows.filter(r => r.status === "cancelled").length;
  const byStatus = showCancelled ? rows : rows.filter(r => r.status !== "cancelled");
  const visible  = qn
    ? byStatus.filter(r => norm(r.title ?? "").includes(qn) || r.students.some(s => norm(s.full_name ?? "").includes(qn) || norm(s.email).includes(qn)))
    : byStatus;
  const cancelLink = (show: boolean) => `/profesor/clases?${new URLSearchParams({ ...(show ? { canceladas: "1" } : {}), ...(q ? { q } : {}) }).toString()}`;
  const upcoming = visible.filter(r => new Date(r.scheduled_at) >= now);
  const past     = visible.filter(r => new Date(r.scheduled_at) <  now).reverse();
  const completedHours = past
    .filter(r => r.status === "completed")
    .reduce((s, r) => s + (r.billed_hours ?? 0), 0);

  return (
    <main className="space-y-5">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Mis clases</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {upcoming.length} próxima{upcoming.length === 1 ? "" : "s"} · {past.length} en el histórico ·{" "}
            {completedHours} h facturadas
          </p>
          {cancelledCount > 0 && (
            <Link
              href={cancelLink(!showCancelled)}
              className="mt-1 inline-block text-xs text-slate-500 dark:text-slate-400 underline underline-offset-2 hover:text-slate-700 dark:hover:text-slate-200"
            >
              {showCancelled ? "Ocultar canceladas" : `Mostrar canceladas (${cancelledCount})`}
            </Link>
          )}
        </div>
        <div className="flex items-center gap-2">
          <form method="get" action="/profesor/clases" className="flex items-center gap-1">
            {showCancelled && <input type="hidden" name="canceladas" value="1" />}
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="Buscar alumno…"
              aria-label="Buscar por alumno"
              className="w-44 sm:w-56 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-1.5 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-400"
            />
            {q && (
              <Link href={cancelLink(showCancelled)} className="text-xs text-slate-500 dark:text-slate-400 hover:underline" aria-label="Quitar filtro">
                Limpiar
              </Link>
            )}
          </form>
          <NewClassButton />
        </div>
      </header>

      {q && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Mostrando solo clases de <strong className="text-slate-700 dark:text-slate-200">{q}</strong>: {visible.length} resultado{visible.length === 1 ? "" : "s"}.
        </p>
      )}

      <Block title="Próximas" rows={upcoming} empty={q ? `Sin clases próximas de "${q}".` : "No tienes clases agendadas."} />
      <Block title="Historial" rows={past}    empty={q ? `Sin clases pasadas de "${q}".` : "Aún no has dado clases en esta plataforma."} />
    </main>
  );
}

function Block({
  title, rows, empty,
}: {
  title: string;
  rows:  Array<{
    id: string; scheduled_at: string; duration_minutes: number;
    title: string; type: string; status: string;
    billed_hours: number; actual_duration_minutes: number | null;
    students: Array<{ full_name: string | null; email: string }>;
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
                href={`/profesor/clases/${c.id}`}
                className="flex items-center justify-between gap-3 py-3 hover:bg-slate-50/60 dark:hover:bg-slate-800/40 -mx-2 px-2 rounded-lg transition-colors"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">{c.title}</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 flex flex-wrap items-center gap-x-1">
                    <span className="capitalize">{formatClassDateEs(c.scheduled_at)}</span>
                    <span>·</span>
                    <span className="font-mono">{formatClassTimeEs(c.scheduled_at)}</span>
                    <span>·</span>
                    <span>{c.duration_minutes} min</span>
                    {c.students.length > 0 && (
                      <>
                        <span>·</span>
                        <span className="truncate max-w-[60vw] sm:max-w-none">
                          {c.students.map(s => s.full_name ?? s.email).join(", ")}
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <span className="text-xs text-slate-500 dark:text-slate-400 shrink-0">
                  {classStatusEs(c.status as Parameters<typeof classStatusEs>[0])}
                  {c.billed_hours > 0 && (
                    <span className="ml-2 font-mono text-emerald-600 dark:text-emerald-400">
                      {c.billed_hours}h
                    </span>
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
