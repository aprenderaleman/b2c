import { requireRoleWithImpersonation } from "@/lib/rbac";
import { getTeacherByUserId } from "@/lib/academy";
import { supabaseAdmin } from "@/lib/supabase";
import { TeacherGroupsList } from "./TeacherGroupsList";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mis grupos · Profesor" };

type Level = "A0" | "A1" | "A2" | "B1" | "B2" | "C1" | "C2";

/**
 * Teacher-scoped version of /admin/grupos. Lists only groups where
 * teacher_id = me, and each card opens the same member-management
 * modal the admin uses (in "teacher" mode). Teachers cannot
 * reassign ownership or archive groups.
 */
export default async function TeacherGroupsPage() {
  const session = await requireRoleWithImpersonation(
    ["teacher", "admin", "superadmin"],
    "teacher",
  );
  const me = await getTeacherByUserId(session.user.id);
  if (!me) {
    return (
      <main>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Mis grupos</h1>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          Tu cuenta no tiene un perfil de profesor.
        </p>
      </main>
    );
  }

  const sb = supabaseAdmin();
  const { data: groups } = await sb
    .from("student_groups")
    .select(`
      id, name, class_type, level, levels, capacity, notes, active,
      student_group_members(
        student:students!inner(
          id, current_level,
          users!inner(full_name, email)
        )
      )
    `)
    .eq("teacher_id", me.id)
    .eq("active", true)
    .order("name", { ascending: true });

  type Row = {
    id: string; name: string; class_type: "group" | "individual";
    level: string | null; levels: Level[] | null;
    capacity: number | null; notes: string | null; active: boolean;
    student_group_members: Array<{
      student: { id: string; current_level: string | null;
                 users: { full_name: string | null; email: string } |
                        Array<{ full_name: string | null; email: string }> } |
               Array<{ id: string; current_level: string | null;
                       users: { full_name: string | null; email: string } |
                              Array<{ full_name: string | null; email: string }> }>;
    }>;
  };

  const list = ((groups ?? []) as Row[]).map(g => {
    const members = (g.student_group_members ?? []).flatMap(m => {
      const s = Array.isArray(m.student) ? m.student[0] : m.student;
      if (!s) return [];
      const u = Array.isArray(s.users) ? s.users[0] : s.users;
      return [{
        student_id: s.id,
        full_name:  u?.full_name ?? null,
        email:      u?.email ?? "",
        level:      s.current_level ?? null,
      }];
    }).sort((a, b) => (a.full_name ?? a.email).localeCompare(b.full_name ?? b.email));

    const levels: Level[] = Array.isArray(g.levels)
      ? g.levels
      : (g.level ? [g.level as Level] : []);

    return {
      id:         g.id,
      name:       g.name,
      class_type: g.class_type,
      levels,
      capacity:   g.capacity,
      notes:      g.notes,
      members,
    };
  });

  return (
    <main className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Mis grupos</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {list.length} grupo{list.length === 1 ? "" : "s"} asignados a ti. Haz clic en cualquiera para editar niveles, capacidad o añadir/quitar estudiantes.
        </p>
      </header>

      <TeacherGroupsList groups={list} />
    </main>
  );
}
