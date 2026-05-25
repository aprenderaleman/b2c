/**
 * Reseñas in-app de estudiantes tras la clase.
 *
 * Se muestra UN solo prompt por carga del dashboard — el más reciente
 * sin reseña ni descarte, dentro de los últimos 7 días. Eso evita
 * abrumar al alumno que tuvo varias clases sin abrir la plataforma.
 */
import { supabaseAdmin } from "./supabase";

export type PendingReview = {
  classId:     string;
  scheduledAt: string;          // ISO
  teacherName: string;
  groupName:   string | null;   // null = 1:1
};

/**
 * Devuelve la clase más reciente atendida por el alumno que aún no
 * tiene fila en class_reviews — o null si no hay nada pendiente.
 *
 * Atendida = class_participants.attended=true (lo marca el trigger
 * en migration 047 cuando se completa billed_hours) o left_at IS NOT
 * NULL (LiveKit webhook). Cualquiera de las dos sirve: el alumno
 * estuvo en el aula.
 */
export async function getPendingReviewForStudent(
  studentId: string,
  now: Date = new Date(),
): Promise<PendingReview | null> {
  const sb = supabaseAdmin();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data } = await sb
    .from("class_participants")
    .select(`
      class_id, attended, left_at,
      classes!inner(
        id, scheduled_at, status,
        group:student_groups(name),
        teacher:teachers!inner(users!inner(full_name))
      )
    `)
    .eq("student_id", studentId)
    .or("attended.eq.true,left_at.not.is.null")
    .gte("classes.scheduled_at", weekAgo)
    .lte("classes.scheduled_at", now.toISOString())
    .neq("classes.status", "cancelled")
    .order("classes(scheduled_at)", { ascending: false })
    .limit(10);

  if (!data || data.length === 0) return null;

  // Filter out the ones already reviewed/dismissed.
  const classIds = data.map((r: { class_id: string }) => r.class_id);
  const { data: already } = await sb
    .from("class_reviews")
    .select("class_id")
    .eq("student_id", studentId)
    .in("class_id", classIds);
  const done = new Set((already ?? []).map((r: { class_id: string }) => r.class_id));

  type Row = {
    class_id: string;
    classes: {
      id: string; scheduled_at: string;
      group: { name: string } | Array<{ name: string }> | null;
      teacher: { users: { full_name: string | null } | Array<{ full_name: string | null }> }
            | Array<{ users: { full_name: string | null } | Array<{ full_name: string | null }> }>;
    };
  };
  for (const r of (data as unknown as Row[])) {
    if (done.has(r.class_id)) continue;
    const c = r.classes;
    const t = Array.isArray(c.teacher) ? c.teacher[0] : c.teacher;
    const tu = Array.isArray(t.users) ? t.users[0] : t.users;
    const g = Array.isArray(c.group) ? c.group[0] : c.group;
    return {
      classId:     c.id,
      scheduledAt: c.scheduled_at,
      teacherName: tu?.full_name ?? "tu profesor",
      groupName:   g?.name ?? null,
    };
  }
  return null;
}
