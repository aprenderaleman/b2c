import Link from "next/link";
import { requireRoleWithImpersonation } from "@/lib/rbac";
import { getTeacherByUserId } from "@/lib/academy";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mis estudiantes · Profesor" };

/**
 * Unique list of students the teacher has taught or is scheduled to teach.
 * Derives from class_participants joined to classes where
 * teacher_id = me.
 */
export default async function TeacherStudentsPage() {
  const session = await requireRoleWithImpersonation(
    ["teacher", "admin", "superadmin"],
    "teacher",
  );
  const me = await getTeacherByUserId(session.user.id);
  if (!me) {
    return (
      <main>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Mis estudiantes</h1>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          Tu cuenta no tiene un perfil de profesor.
        </p>
      </main>
    );
  }

  const sb = supabaseAdmin();
  const { data } = await sb
    .from("class_participants")
    .select(`
      student_id,
      students!inner(current_level, users!inner(full_name, email)),
      classes!inner(teacher_id)
    `)
    .eq("classes.teacher_id", me.id);

  type R = {
    student_id: string;
    students: {
      current_level: string;
      users: { full_name: string | null; email: string } | Array<{ full_name: string | null; email: string }>;
    } | Array<{
      current_level: string;
      users: { full_name: string | null; email: string } | Array<{ full_name: string | null; email: string }>;
    }>;
  };

  const seen = new Map<string, { id: string; name: string | null; email: string; level: string }>();
  for (const r of (data ?? []) as R[]) {
    if (seen.has(r.student_id)) continue;
    const s = Array.isArray(r.students) ? r.students[0] : r.students;
    if (!s) continue;
    const u = Array.isArray(s.users) ? s.users[0] : s.users;
    seen.set(r.student_id, {
      id:    r.student_id,
      name:  u?.full_name ?? null,
      email: u?.email ?? "",
      level: s.current_level,
    });
  }
  const list = Array.from(seen.values()).sort((a, b) => (a.name ?? a.email).localeCompare(b.name ?? b.email));

  return (
    <main className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Mis estudiantes</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {list.length} estudiante{list.length === 1 ? "" : "s"} a los que das clase.
        </p>
      </header>

      <section className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden">
        {list.length === 0 ? (
          <p className="p-6 text-sm text-slate-500 dark:text-slate-400">
            Aún no te han asignado estudiantes. Aparecerán aquí cuando el admin agende una clase contigo.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {list.map(s => (
              <li key={s.id}>
                <Link
                  href={`/profesor/estudiantes/${s.id}`}
                  className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-slate-50/60 dark:hover:bg-slate-800/40"
                >
                  <div>
                    <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
                      {s.name ?? s.email}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 font-mono">{s.email}</div>
                  </div>
                  <span className="text-xs text-slate-500 dark:text-slate-400">{s.level}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
