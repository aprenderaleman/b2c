import { supabaseAdmin } from "./supabase";

export type StudentGroupRow = {
  id:            string;
  name:          string;
  class_type:    "group" | "individual";
  level:         string | null;
  teacher_id:    string | null;
  start_date:    string | null;
  end_date:      string | null;
  meet_link:     string | null;
  document_url:  string | null;
  active:        boolean;
  notes:         string | null;
  created_at:    string;
};

/**
 * Returns the student_group a given class belongs to (if any — historical
 * classes and Maria Eugenia-style ad-hoc classes can have group_id null).
 */
export async function getGroupForClass(classId: string): Promise<StudentGroupRow | null> {
  const sb = supabaseAdmin();
  const { data } = await sb
    .from("classes")
    .select(`
      group_id,
      group:student_groups(
        id, name, class_type, level, teacher_id, start_date, end_date,
        meet_link, document_url, active, notes, created_at
      )
    `)
    .eq("id", classId)
    .maybeSingle();
  if (!data?.group_id) return null;
  const g = (data as { group: unknown }).group;
  return (Array.isArray(g) ? g[0] : g) as StudentGroupRow | null;
}

/**
 * All student_groups (for admin list pages).
 */
export async function listAllStudentGroups(): Promise<
  Array<StudentGroupRow & { teacher_name: string | null; member_count: number }>
> {
  const sb = supabaseAdmin();
  const { data } = await sb
    .from("student_groups")
    .select(`
      id, name, class_type, level, teacher_id, start_date, end_date,
      meet_link, document_url, active, notes, created_at,
      teacher:teachers(users(full_name)),
      student_group_members(student_id)
    `)
    .order("active", { ascending: false })
    .order("name", { ascending: true });

  return ((data ?? []) as unknown[]).map(raw => {
    const r = raw as Record<string, unknown>;
    const t = r.teacher as Record<string, unknown> | Record<string, unknown>[] | null;
    const tf = Array.isArray(t) ? t[0] : t;
    const u = tf?.users as Record<string, unknown> | Record<string, unknown>[];
    const uf = Array.isArray(u) ? u[0] : u;
    const members = (r.student_group_members as unknown[] | undefined) ?? [];
    return {
      id:           r.id as string,
      name:         r.name as string,
      class_type:   (r.class_type as "group" | "individual"),
      level:        (r.level as string | null) ?? null,
      teacher_id:   (r.teacher_id as string | null) ?? null,
      start_date:   (r.start_date as string | null) ?? null,
      end_date:     (r.end_date as string | null) ?? null,
      meet_link:    (r.meet_link as string | null) ?? null,
      document_url: (r.document_url as string | null) ?? null,
      active:       Boolean(r.active),
      notes:        (r.notes as string | null) ?? null,
      created_at:   r.created_at as string,
      teacher_name: (uf?.full_name as string | null) ?? null,
      member_count: members.length,
    };
  });
}
