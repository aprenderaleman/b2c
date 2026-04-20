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

/**
 * The OTHER thing the student dashboard cares about: is any class the
 * student is a participant of CURRENTLY live? This powers the big green
 * "Entrar ahora" CTA that appears as soon as the teacher clicks
 * "Iniciar clase ahora", without the student having to reload.
 *
 * Only status='live' — we ignore scheduled_at/duration_minutes so that
 * on-demand classes (started before their scheduled time, or with a
 * placeholder duration) still surface.
 */
export type LiveClassInfo = {
  classId:     string;
  title:       string;
  teacherName: string;
  startedAt:   string;
};

// Safety cap: if a class has been flagged live for longer than this,
// the teacher almost certainly closed the tab without hitting "end".
// Don't haunt the student with a ghost CTA — pretend it's not live.
// Any legitimate class longer than 4 hours is extremely unusual.
const STALE_LIVE_CUTOFF_MS = 4 * 60 * 60 * 1000;

export async function getLiveClassForStudent(
  studentId: string,
): Promise<LiveClassInfo | null> {
  const sb = supabaseAdmin();
  const { data } = await sb
    .from("class_participants")
    .select(`
      class:classes!inner(
        id, title, status, started_at, scheduled_at,
        teachers!inner(users!inner(full_name, email))
      )
    `)
    .eq("student_id", studentId)
    .eq("class.status", "live")
    .order("class(started_at)", { ascending: false })
    .limit(1);

  type Row = {
    class: {
      id: string; title: string; status: string;
      started_at: string | null; scheduled_at: string;
      teachers: { users: { full_name: string | null; email: string } |
                  Array<{ full_name: string | null; email: string }> } |
                Array<{ users: { full_name: string | null; email: string } |
                        Array<{ full_name: string | null; email: string }> }>;
    } | Array<{
      id: string; title: string; status: string;
      started_at: string | null; scheduled_at: string;
      teachers: unknown;
    }>;
  };
  const rows = (data ?? []) as Row[];
  if (rows.length === 0) return null;
  const c = Array.isArray(rows[0].class) ? rows[0].class[0] : rows[0].class;
  if (!c) return null;

  // Stale-live guard: if the class has been flagged 'live' for more than
  // STALE_LIVE_CUTOFF_MS, the teacher almost certainly closed the tab
  // without hitting "Terminar". Treat as not live so the student doesn't
  // chase a ghost CTA into an empty room.
  const startedAt = (c as { started_at: string | null; scheduled_at: string }).started_at
                 ?? (c as { scheduled_at: string }).scheduled_at;
  const ageMs = Date.now() - new Date(startedAt).getTime();
  if (ageMs > STALE_LIVE_CUTOFF_MS) return null;

  const t  = (c as { teachers: unknown }).teachers;
  const tt = (Array.isArray(t) ? t[0] : t) as { users: unknown } | undefined;
  const u  = tt?.users;
  const uu = (Array.isArray(u) ? u[0] : u) as
    | { full_name: string | null; email: string } | undefined;
  return {
    classId:     (c as { id: string }).id,
    title:       (c as { title: string }).title,
    teacherName: uu?.full_name ?? uu?.email ?? "Tu profesor",
    startedAt,
  };
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
