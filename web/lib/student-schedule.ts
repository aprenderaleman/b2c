import { supabaseAdmin } from "./supabase";
import { listTeacherClassSlots } from "./trial-slots";

/**
 * Agendado self-service del alumno (fase 3 — Gelfis 2026-10-06).
 * Reglas confirmadas:
 *   - antelación mínima 12 h (la aplica el motor de slots)
 *   - reagendar solo hasta 24 h antes de la clase original
 *   - límite = saldo de clases (lo aplica createClass via canBookClass)
 *   - solo clases individuales con SU profe (grupos: el profe)
 */

export const STUDENT_CLASS_MINUTES = 50;
export const RESCHEDULE_CUTOFF_HOURS = 24;

export type StudentTeacher = { teacherId: string; teacherUserId: string; teacherName: string };

/** Profe del alumno: grupo activo primero, trial_teacher_id como fallback. */
export async function resolveStudentTeacher(studentId: string): Promise<StudentTeacher | null> {
  const sb = supabaseAdmin();
  const { data: viaGroup } = await sb
    .from("student_group_members")
    .select("student_groups!inner(active, teachers!inner(id, user_id, users!inner(full_name, email)))")
    .eq("student_id", studentId)
    .eq("student_groups.active", true)
    .limit(1);
  const first = <T,>(v: T | T[] | null | undefined): T | undefined => (Array.isArray(v) ? v[0] : v ?? undefined);
  const g = first((viaGroup ?? [])[0]?.student_groups as unknown as { teachers: unknown } | Array<{ teachers: unknown }>);
  const tG = first(g?.teachers as { id: string; user_id: string; users: unknown } | Array<{ id: string; user_id: string; users: unknown }>);
  if (tG) {
    const u = first(tG.users as { full_name: string | null; email: string } | Array<{ full_name: string | null; email: string }>);
    return { teacherId: tG.id, teacherUserId: tG.user_id, teacherName: u?.full_name ?? u?.email ?? "tu profesor" };
  }

  const { data: stu } = await sb
    .from("students")
    .select("trial_teacher_id")
    .eq("id", studentId)
    .maybeSingle();
  const tid = (stu as { trial_teacher_id: string | null } | null)?.trial_teacher_id;
  if (!tid) return null;
  const { data: t } = await sb
    .from("teachers")
    .select("id, user_id, users!inner(full_name, email)")
    .eq("id", tid)
    .maybeSingle();
  if (!t) return null;
  const u = first((t as { users: unknown }).users as { full_name: string | null; email: string } | Array<{ full_name: string | null; email: string }>);
  return {
    teacherId: (t as { id: string }).id,
    teacherUserId: (t as { user_id: string }).user_id,
    teacherName: u?.full_name ?? u?.email ?? "tu profesor",
  };
}

/** ¿Sigue libre este inicio exacto para el profe? Recalcula el motor. */
export async function isSlotStillFree(teacherId: string, startIso: string): Promise<boolean> {
  const slots = await listTeacherClassSlots(teacherId);
  const target = new Date(startIso).getTime();
  return slots.some(s => new Date(s.startIso).getTime() === target);
}
