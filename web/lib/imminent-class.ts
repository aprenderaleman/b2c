import { supabaseAdmin } from "./supabase";

/**
 * Finds THE next class (scheduled/live) that the given user is involved
 * in, across a horizon wide enough to catch overnight classes but narrow
 * enough to stay in-memory cheap. Used by the sticky imminent-class
 * banner at the top of /estudiante/* and /profesor/* layouts — we only
 * render the banner if this returns something <30 min away.
 *
 * Returns null when there is nothing upcoming within the next 12 hours
 * or running right now.
 */

export type ImminentClass = {
  id:               string;
  title:            string;
  scheduled_at:     string;
  duration_minutes: number;
};

export async function getImminentClassForStudent(
  studentId: string,
): Promise<ImminentClass | null> {
  const sb = supabaseAdmin();
  const now  = new Date();
  const from = new Date(now.getTime() - 30 * 60_000);          // include live
  const to   = new Date(now.getTime() + 12 * 3600 * 1000);     // 12h forward

  const { data } = await sb
    .from("class_participants")
    .select(`
      class:classes!inner(
        id, title, scheduled_at, duration_minutes, status
      )
    `)
    .eq("student_id", studentId)
    .gte("class.scheduled_at", from.toISOString())
    .lte("class.scheduled_at", to.toISOString())
    .in("class.status", ["scheduled", "live"])
    .order("class(scheduled_at)", { ascending: true })
    .limit(1);

  return extractFirst(data);
}

export async function getImminentClassForTeacher(
  teacherId: string,
): Promise<ImminentClass | null> {
  const sb = supabaseAdmin();
  const now  = new Date();
  const from = new Date(now.getTime() - 30 * 60_000);
  const to   = new Date(now.getTime() + 12 * 3600 * 1000);

  const { data } = await sb
    .from("classes")
    .select("id, title, scheduled_at, duration_minutes, status")
    .eq("teacher_id", teacherId)
    .gte("scheduled_at", from.toISOString())
    .lte("scheduled_at", to.toISOString())
    .in("status", ["scheduled", "live"])
    .order("scheduled_at", { ascending: true })
    .limit(1);

  const first = (data ?? [])[0] as
    | { id: string; title: string; scheduled_at: string; duration_minutes: number }
    | undefined;
  return first ? {
    id: first.id, title: first.title,
    scheduled_at: first.scheduled_at, duration_minutes: first.duration_minutes,
  } : null;
}

function extractFirst(data: unknown): ImminentClass | null {
  const rows = (data ?? []) as Array<{ class: unknown }>;
  if (rows.length === 0) return null;
  const c = Array.isArray(rows[0].class) ? (rows[0].class as unknown[])[0] : rows[0].class;
  if (!c) return null;
  const cc = c as Record<string, unknown>;
  return {
    id:               cc.id as string,
    title:            cc.title as string,
    scheduled_at:     cc.scheduled_at as string,
    duration_minutes: cc.duration_minutes as number,
  };
}
