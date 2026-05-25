import Link from "next/link";
import { requireRole } from "@/lib/rbac";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reseñas · Admin" };

type SP = Promise<Record<string, string | string[] | undefined>>;

const PAGE_SIZE = 50;

type ReviewRow = {
  id:         string;
  class_id:   string;
  student_id: string;
  rating:     number | null;
  comment:    string | null;
  dismissed_at: string | null;
  created_at: string;
  classes: {
    id: string; scheduled_at: string;
    group: { name: string } | Array<{ name: string }> | null;
    teacher: { id: string; users: { full_name: string | null } | Array<{ full_name: string | null }> }
          | Array<{ id: string; users: { full_name: string | null } | Array<{ full_name: string | null }> }>;
  };
  students: { users: { full_name: string | null; email: string } | Array<{ full_name: string | null; email: string }> }
         | Array<{ users: { full_name: string | null; email: string } | Array<{ full_name: string | null; email: string }> }>;
};

export default async function ReviewsAdminPage({
  searchParams,
}: {
  searchParams: SP;
}) {
  await requireRole(["admin", "superadmin"]);
  const sp = await searchParams;

  const page = Math.max(1, Number(sp.page ?? 1));
  const ratingF  = typeof sp.rating  === "string" ? sp.rating  : "";  // "1".."5" o ""
  const teacherF = typeof sp.teacher === "string" ? sp.teacher : "";  // teachers.id
  const showDismissed = sp.dismissed === "1";

  const sb = supabaseAdmin();

  // 1. List teachers para el filtro
  const { data: teachersRaw } = await sb
    .from("teachers")
    .select("id, users!inner(full_name, email)")
    .order("id");
  type T = { id: string; users: { full_name: string | null; email: string } | Array<{ full_name: string | null; email: string }> };
  const teachers = ((teachersRaw ?? []) as unknown as T[]).map(t => {
    const u = Array.isArray(t.users) ? t.users[0] : t.users;
    return { id: t.id, label: u?.full_name || u?.email || t.id };
  }).sort((a, b) => a.label.localeCompare(b.label));

  // 2. Reviews query
  let q = sb
    .from("class_reviews")
    .select(`
      id, class_id, student_id, rating, comment, dismissed_at, created_at,
      classes!inner(
        id, scheduled_at,
        group:student_groups(name),
        teacher:teachers!inner(id, users!inner(full_name))
      ),
      students!inner(
        users!inner(full_name, email)
      )
    `, { count: "exact" });

  if (!showDismissed) q = q.is("dismissed_at", null);
  if (ratingF)        q = q.eq("rating", Number(ratingF));
  if (teacherF)       q = q.eq("classes.teacher_id", teacherF);

  q = q.order("created_at", { ascending: false })
       .range((page - 1) * PAGE_SIZE, (page - 1) * PAGE_SIZE + PAGE_SIZE - 1);

  const { data, count } = await q;
  const rows = (data ?? []) as unknown as ReviewRow[];
  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // 3. Stats globales (rating != null, dismissed_at is null) — un solo query
  const { data: stats } = await sb
    .from("class_reviews")
    .select("rating", { count: "exact" })
    .not("rating", "is", null);
  const allRatings = ((stats ?? []) as Array<{ rating: number }>).map(s => s.rating);
  const totalRatings = allRatings.length;
  const avg = totalRatings > 0
    ? (allRatings.reduce((a, b) => a + b, 0) / totalRatings)
    : 0;
  const dist = [1,2,3,4,5].map(n => ({
    n,
    count: allRatings.filter(r => r === n).length,
  }));

  return (
    <main className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Reseñas</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Lo que opinan los estudiantes después de cada clase. {total.toLocaleString("es-ES")} resultado{total === 1 ? "" : "s"}.
        </p>
      </header>

      {/* Stats card */}
      <section className="grid gap-4 lg:grid-cols-3 rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Promedio global</p>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-4xl font-bold text-slate-900 dark:text-slate-50">{avg.toFixed(2)}</span>
            <span className="text-amber-400 text-2xl">★</span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {totalRatings.toLocaleString("es-ES")} reseña{totalRatings === 1 ? "" : "s"} con puntuación
          </p>
        </div>
        <div className="lg:col-span-2 space-y-1.5">
          {dist.slice().reverse().map(d => {
            const pct = totalRatings > 0 ? (d.count / totalRatings) * 100 : 0;
            return (
              <div key={d.n} className="flex items-center gap-3 text-xs">
                <span className="w-8 tabular-nums text-slate-600 dark:text-slate-300">{d.n} ★</span>
                <div className="flex-1 h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                  <div
                    className="h-full bg-amber-400"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="w-12 tabular-nums text-right text-slate-500 dark:text-slate-400">{d.count}</span>
              </div>
            );
          })}
        </div>
      </section>

      {/* Filters */}
      <form method="get" className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 grid gap-3 sm:grid-cols-4">
        <select name="rating" defaultValue={ratingF} className="input-text">
          <option value="">Cualquier puntuación</option>
          {[5,4,3,2,1].map(n => (
            <option key={n} value={n}>{"★".repeat(n)} ({n})</option>
          ))}
        </select>
        <select name="teacher" defaultValue={teacherF} className="input-text sm:col-span-2">
          <option value="">Cualquier profesor</option>
          {teachers.map(t => (
            <option key={t.id} value={t.id}>{t.label}</option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
          <input
            type="checkbox"
            name="dismissed"
            value="1"
            defaultChecked={showDismissed}
            className="rounded border-slate-300 dark:border-slate-700"
          />
          Incluir descartadas
        </label>
        <button type="submit" className="btn-primary sm:col-span-4 sm:justify-self-start">
          Filtrar
        </button>
      </form>

      {/* List */}
      <section className="space-y-3">
        {rows.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center text-sm text-slate-500 dark:text-slate-400">
            Aún no hay reseñas con estos filtros.
          </div>
        ) : (
          rows.map(r => {
            const c = r.classes;
            const t = Array.isArray(c.teacher) ? c.teacher[0] : c.teacher;
            const tu = Array.isArray(t.users) ? t.users[0] : t.users;
            const s = Array.isArray(r.students) ? r.students[0] : r.students;
            const su = Array.isArray(s.users) ? s.users[0] : s.users;
            const g = Array.isArray(c.group) ? c.group[0] : c.group;
            const when = new Date(c.scheduled_at).toLocaleString("es-ES", {
              timeZone: "Europe/Berlin", day: "2-digit", month: "short", year: "2-digit",
              hour: "2-digit", minute: "2-digit",
            });
            const reviewWhen = new Date(r.created_at).toLocaleString("es-ES", {
              timeZone: "Europe/Berlin", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
            });
            return (
              <article
                key={r.id}
                className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-2"
              >
                <header className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <div className="flex items-center gap-2">
                      {r.rating !== null ? (
                        <span className="text-amber-400 text-base leading-none">
                          {"★".repeat(r.rating)}<span className="text-slate-300 dark:text-slate-600">{"★".repeat(5 - r.rating)}</span>
                        </span>
                      ) : (
                        <span className="text-xs italic text-slate-500 dark:text-slate-400">Descartada sin puntuar</span>
                      )}
                    </div>
                    <div className="mt-1 text-sm text-slate-900 dark:text-slate-100">
                      <Link
                        href={`/admin/profesores/${t.id}`}
                        className="font-medium hover:underline"
                      >
                        {tu?.full_name ?? "Profesor"}
                      </Link>
                      <span className="text-slate-400 mx-1.5">·</span>
                      <span>{su?.full_name ?? su?.email ?? "Alumno"}</span>
                      {g && (
                        <>
                          <span className="text-slate-400 mx-1.5">·</span>
                          <span className="text-slate-500 dark:text-slate-400">{g.name}</span>
                        </>
                      )}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      Clase del {when} · reseñada {reviewWhen}
                    </div>
                  </div>
                </header>
                {r.comment && (
                  <blockquote className="text-sm text-slate-700 dark:text-slate-200 border-l-2 border-amber-400 pl-3 italic">
                    “{r.comment}”
                  </blockquote>
                )}
              </article>
            );
          })
        )}
      </section>

      {/* Pagination */}
      {totalPages > 1 && (
        <nav className="flex items-center justify-center gap-2 pt-2 text-sm">
          {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => {
            const params = new URLSearchParams();
            if (ratingF)        params.set("rating", ratingF);
            if (teacherF)       params.set("teacher", teacherF);
            if (showDismissed)  params.set("dismissed", "1");
            if (p > 1)          params.set("page", String(p));
            const qs = params.toString();
            return (
              <Link
                key={p}
                href={qs ? `?${qs}` : "?"}
                className={`px-3 py-1 rounded-full border ${
                  p === page
                    ? "bg-brand-500 border-brand-500 text-white"
                    : "border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                }`}
              >
                {p}
              </Link>
            );
          })}
        </nav>
      )}
    </main>
  );
}
