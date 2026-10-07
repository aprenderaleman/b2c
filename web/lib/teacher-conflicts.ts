import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Detección de solapes en la agenda de un profe (cualquier clase activa:
 * trials y clases normales), con la misma pausa entre clases que usa el
 * slot picker (lib/trial-slots BREAK_MINUTES).
 *
 * El unique index 088 solo impide dos clases a la MISMA hora exacta; esto
 * cubre solapes parciales y, llamado DESPUÉS de escribir la clase, cierra
 * la carrera de dos leads reservando a la vez huecos que se pisan.
 */
export const CLASS_BREAK_MINUTES = 10;
const MAX_CLASS_MINUTES = 240;

export type ConflictRow = {
  id: string;
  scheduled_at: string;
  duration_minutes: number | null;
  created_at: string;
};

export async function findTeacherConflicts(
  sb: SupabaseClient,
  opts: {
    teacherId: string; startIso: string; durationMinutes: number; excludeClassId?: string;
    /** Otros ids a ignorar (p. ej. el resto de una serie que se mueve a la vez). */
    excludeIds?: string[];
    /** Pausa exigida entre clases. Default 10 (reservas de leads); 0 = solo solape real (ediciones manuales). */
    breakMinutes?: number;
  },
): Promise<ConflictRow[]> {
  const start = new Date(opts.startIso).getTime();
  const end = start + opts.durationMinutes * 60_000;
  const buf = (opts.breakMinutes ?? CLASS_BREAK_MINUTES) * 60_000;

  let q = sb
    .from("classes")
    .select("id, scheduled_at, duration_minutes, created_at")
    .eq("teacher_id", opts.teacherId)
    .is("deleted_at", null)
    .in("status", ["scheduled", "live"])
    .gte("scheduled_at", new Date(start - MAX_CLASS_MINUTES * 60_000 - buf).toISOString())
    .lt("scheduled_at", new Date(end + buf).toISOString());
  if (opts.excludeClassId) q = q.neq("id", opts.excludeClassId);

  const { data, error } = await q;
  if (error) throw new Error(`conflict_check_failed: ${error.message}`);

  const skip = new Set(opts.excludeIds ?? []);
  return ((data ?? []) as ConflictRow[]).filter(r => {
    if (skip.has(r.id)) return false;
    const s = new Date(r.scheduled_at).getTime();
    const e = s + (r.duration_minutes ?? 40) * 60_000;
    return s < end + buf && e > start - buf;
  });
}

/**
 * Para una clase recién insertada: ¿hay otra clase activa que la pisa y
 * llegó antes? En empate de created_at gana el id menor, así de dos
 * inserciones simultáneas sobrevive exactamente una.
 */
export function earlierConflicts(conflicts: ConflictRow[], mine: { id: string; created_at: string }): ConflictRow[] {
  return conflicts.filter(c =>
    c.created_at < mine.created_at || (c.created_at === mine.created_at && c.id < mine.id));
}
