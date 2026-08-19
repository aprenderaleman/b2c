import Link from "next/link";
import { requireRoleWithImpersonation } from "@/lib/rbac";
import { getTeacherByUserId } from "@/lib/academy";
import { supabaseAdmin } from "@/lib/supabase";
import { ViewAsStudentButton } from "@/components/teacher/ViewAsStudentButton";
import { getClassBalance } from "@/lib/class-balance";

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
  // Source of truth: students in an active group assigned to this teacher.
  const { data: viaGroups } = await sb.from("student_group_members")
    .select(`
      student_id,
      students!inner(current_level, classes_remaining, oferta_id, clases_totales, users!inner(full_name, email)),
      group:student_groups!inner(teacher_id, active)
    `)
    .eq("group.teacher_id", me.id)
    .eq("group.active", true);

  type R = {
    student_id: string;
    students: {
      current_level: string;
      classes_remaining: number | null;
      oferta_id: string | null;
      clases_totales: number | null;
      users: { full_name: string | null; email: string } | Array<{ full_name: string | null; email: string }>;
    } | Array<{
      current_level: string;
      classes_remaining: number | null;
      oferta_id: string | null;
      clases_totales: number | null;
      users: { full_name: string | null; email: string } | Array<{ full_name: string | null; email: string }>;
    }>;
  };

  type Item = {
    id: string; name: string | null; email: string; level: string;
    classesRemaining: number | null; hasOferta: boolean;
    disponibles: number | null; desbloqueadas: number | null;
  };
  const seen = new Map<string, Item>();
  const ingest = (rows: R[]) => {
    for (const r of rows) {
      if (seen.has(r.student_id)) continue;
      const s = Array.isArray(r.students) ? r.students[0] : r.students;
      if (!s) continue;
      const u = Array.isArray(s.users) ? s.users[0] : s.users;
      seen.set(r.student_id, {
        id:    r.student_id,
        name:  u?.full_name ?? null,
        email: u?.email ?? "",
        level: s.current_level,
        classesRemaining: s.classes_remaining ?? null,
        hasOferta: !!s.oferta_id || s.clases_totales != null,
        disponibles: null,
        desbloqueadas: null,
      });
    }
  };
  ingest((viaGroups ?? []) as R[]);

  // Alumnos del Método (con oferta): la agenda descuenta del balance
  // MENSUAL (desbloqueadas - consumidas - agendadas), no del total del
  // pack. Caso Jonathan/Nancy 2026-08-20: la lista decía "45 clases"
  // (total restante) pero al agendar solo había 5 disponibles del mes.
  // Mostramos AMBOS números para que el profe sepa cuántas puede
  // agendar YA y cuántas quedan del pack.
  await Promise.all(
    Array.from(seen.values())
      .filter(s => s.hasOferta)
      .map(async (s) => {
        const b = await getClassBalance(s.id).catch(() => null);
        if (b) {
          s.disponibles = b.disponibles;
          s.desbloqueadas = b.desbloqueadas;
        }
      }),
  );

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
              <li key={s.id} className="flex items-center gap-2 px-5 py-3 hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                <Link
                  href={`/profesor/estudiantes/${s.id}`}
                  className="flex flex-1 min-w-0 items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                      {s.name ?? s.email}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 font-mono truncate">{s.email}</div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {s.hasOferta && s.disponibles != null ? (
                      <span className="text-right">
                        <span className={`block text-xs font-semibold tabular-nums ${
                          s.disponibles <= 1
                            ? "text-red-600 dark:text-red-400"
                            : s.disponibles <= 3
                              ? "text-amber-600 dark:text-amber-400"
                              : "text-emerald-600 dark:text-emerald-400"
                        }`}>
                          {s.disponibles} agendable{s.disponibles === 1 ? "" : "s"} ahora
                        </span>
                        {s.classesRemaining != null && (
                          <span className="block text-[10px] text-slate-500 dark:text-slate-400 tabular-nums">
                            {s.classesRemaining} restantes del pack
                          </span>
                        )}
                      </span>
                    ) : s.classesRemaining != null && (
                      <span className={`text-xs font-medium tabular-nums ${
                        s.classesRemaining <= 5
                          ? "text-red-600 dark:text-red-400"
                          : s.classesRemaining <= 15
                            ? "text-amber-600 dark:text-amber-400"
                            : "text-emerald-600 dark:text-emerald-400"
                      }`}>
                        {s.classesRemaining} clase{s.classesRemaining === 1 ? "" : "s"}
                      </span>
                    )}
                    <span className="text-xs text-slate-500 dark:text-slate-400">{s.level}</span>
                  </div>
                </Link>
                <ViewAsStudentButton studentId={s.id} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
