import { supabaseAdmin } from "./supabase";

export type AvailabilityBlock = {
  id:           string;
  teacher_id:   string;
  day_of_week:  number;     // 0 (Sun) – 6 (Sat)
  start_time:   string;     // "HH:MM:SS"
  end_time:     string;
  available:    boolean;
  valid_from:   string | null;
  valid_until:  string | null;
};

/**
 * Fetch every availability block for a teacher, ordered by day then
 * start time. Used by /profesor/disponibilidad and the admin picker
 * (so admin can see "Juan is typically free Wed 14-18" while scheduling).
 */
export async function getTeacherAvailability(teacherId: string): Promise<AvailabilityBlock[]> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("teacher_availability")
    .select("id, teacher_id, day_of_week, start_time, end_time, available, valid_from, valid_until")
    .eq("teacher_id", teacherId)
    .order("day_of_week", { ascending: true })
    .order("start_time",  { ascending: true });
  if (error) throw error;
  return (data ?? []) as AvailabilityBlock[];
}

export type AvailabilityDraft = Array<{
  day_of_week: number;
  start_time:  string;     // "HH:MM"
  end_time:    string;
  available:   boolean;
}>;

/**
 * Replace the teacher's entire availability set with the provided draft.
 * Runs as a single transaction-ish pair of operations (delete-all,
 * insert-fresh). If the insert fails, the teacher ends up empty — the
 * UI will always show their current state on next load, so this is
 * acceptable for a rarely-touched config page.
 */
export async function replaceTeacherAvailability(
  teacherId: string,
  draft: AvailabilityDraft,
): Promise<void> {
  const sb = supabaseAdmin();
  const { error: delErr } = await sb.from("teacher_availability").delete().eq("teacher_id", teacherId);
  if (delErr) throw new Error(`clear failed: ${delErr.message}`);

  if (draft.length === 0) return;

  const rows = draft.map(d => ({
    teacher_id:  teacherId,
    day_of_week: d.day_of_week,
    start_time:  d.start_time,
    end_time:    d.end_time,
    available:   d.available,
  }));
  const { error: insErr } = await sb.from("teacher_availability").insert(rows);
  if (insErr) throw new Error(`insert failed: ${insErr.message}`);
}

// Day labels in Spanish (Monday-first for EU users).
export const DAY_LABELS_ES = [
  "Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado",
] as const;

// EU-friendly display order: Mon → Sun.
export const WEEK_ORDER: number[] = [1, 2, 3, 4, 5, 6, 0];
