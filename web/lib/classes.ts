import { supabaseAdmin } from "./supabase";

// =============================================================================
// Types
// =============================================================================

export type ClassType        = "individual" | "group";
export type ClassStatus      = "scheduled" | "live" | "completed" | "cancelled" | "absent";
export type RecurrencePattern = "none" | "weekly" | "biweekly" | "monthly";

export type ClassRow = {
  id:                      string;
  type:                    ClassType;
  teacher_id:              string;
  scheduled_at:            string;
  duration_minutes:        number;
  recurrence_pattern:      RecurrencePattern;
  recurrence_end_date:     string | null;
  parent_class_id:         string | null;
  title:                   string;
  topic:                   string | null;
  status:                  ClassStatus;
  livekit_room_id:         string;
  is_trial:                boolean;
  started_at:              string | null;
  ended_at:                string | null;
  actual_duration_minutes: number | null;
  notes_admin:             string | null;
  created_at:              string;
};

export type ClassWithPeople = ClassRow & {
  teacher_name:     string | null;
  teacher_email:    string;
  participants:     Array<{
    student_id:   string;
    student_name: string | null;
    student_email: string;
    student_phone: string | null;
    attended:     boolean | null;
  }>;
};

export type CreateClassInput = {
  type:                ClassType;
  teacherId:           string;
  studentIds:          string[];          // ≥1 for individual, ≥1 for group
  scheduledAt:         Date;
  durationMinutes:     number;
  recurrencePattern:   RecurrencePattern;
  recurrenceEndDate:   Date | null;
  title:               string;
  topic:               string | null;
  notesAdmin:          string | null;
  createdByUserId:     string | null;
};

// Cap to avoid someone accidentally generating 500 classes.
const MAX_RECURRING_INSTANCES = 52;

// =============================================================================
// Create — single or recurring series
// =============================================================================

/**
 * Create a class (possibly a recurring series). Returns the array of created
 * class IDs. For recurring patterns the first element is the parent.
 *
 * Recurrence generation:
 *   - 'none'     → 1 row
 *   - 'weekly'   → one row per 7 days up to recurrence_end_date
 *   - 'biweekly' → every 14 days
 *   - 'monthly'  → same day of month for N months (naïve — handles Feb/30th
 *                  the way JS Date does, which is correct for our use)
 *
 * Cap at MAX_RECURRING_INSTANCES to prevent runaway inserts.
 */
export async function createClass(input: CreateClassInput): Promise<{
  parentId: string;
  ids:      string[];
}> {
  if (input.studentIds.length === 0) {
    throw new Error("studentIds must have at least one student");
  }
  if (input.type === "individual" && input.studentIds.length !== 1) {
    throw new Error("individual classes must have exactly one student");
  }

  const sb = supabaseAdmin();
  const dates = expandRecurrence(
    input.scheduledAt,
    input.recurrencePattern,
    input.recurrenceEndDate,
  );

  // Insert the first class (the parent). We need its ID to backfill as
  // parent_class_id on the rest.
  const firstRow = {
    type:                input.type,
    teacher_id:          input.teacherId,
    scheduled_at:        dates[0].toISOString(),
    duration_minutes:    input.durationMinutes,
    recurrence_pattern:  input.recurrencePattern,
    recurrence_end_date: input.recurrenceEndDate
      ? input.recurrenceEndDate.toISOString().slice(0, 10)
      : null,
    parent_class_id:     null,
    title:               input.title,
    topic:               input.topic,
    notes_admin:         input.notesAdmin,
    created_by:          input.createdByUserId,
    status:              "scheduled" as ClassStatus,
  };

  const { data: parent, error: parentErr } = await sb
    .from("classes")
    .insert(firstRow)
    .select("id")
    .single();
  if (parentErr || !parent) {
    throw new Error(`first class insert failed: ${parentErr?.message ?? "unknown"}`);
  }
  const parentId = parent.id as string;

  // Patch parent_class_id back onto the parent (points to itself) so
  // every instance in a series — including the parent — can be queried
  // by parent_class_id = <head>.
  await sb.from("classes").update({ parent_class_id: parentId }).eq("id", parentId);

  // Bulk-insert the remaining instances (if any).
  const remaining = dates.slice(1).map(d => ({
    ...firstRow,
    scheduled_at:    d.toISOString(),
    parent_class_id: parentId,
  }));
  const ids: string[] = [parentId];
  if (remaining.length > 0) {
    const { data: rest, error: restErr } = await sb
      .from("classes")
      .insert(remaining)
      .select("id");
    if (restErr) {
      throw new Error(`recurring instances insert failed: ${restErr.message}`);
    }
    for (const r of rest ?? []) ids.push(r.id as string);
  }

  // Insert participants for every instance (cross-product).
  const participantRows = ids.flatMap(classId =>
    input.studentIds.map(sid => ({
      class_id:   classId,
      student_id: sid,
    })),
  );
  const { error: partErr } = await sb.from("class_participants").insert(participantRows);
  if (partErr) {
    // Best-effort rollback: delete all created classes.
    await sb.from("classes").delete().in("id", ids);
    throw new Error(`participants insert failed: ${partErr.message}`);
  }

  return { parentId, ids };
}

/**
 * Expand a single scheduled_at + pattern + end_date into the list of dates
 * that actually become classes. Always returns at least one date (the head).
 */
function expandRecurrence(
  start: Date,
  pattern: RecurrencePattern,
  endDate: Date | null,
): Date[] {
  if (pattern === "none" || !endDate) return [start];

  const out: Date[] = [start];
  const stride =
    pattern === "weekly"   ? 7  :
    pattern === "biweekly" ? 14 :
    /* monthly */            null;

  const cursor = new Date(start);
  while (true) {
    if (stride !== null) {
      cursor.setUTCDate(cursor.getUTCDate() + stride);
    } else {
      // monthly — increment month, JS clamps Feb 31 → Mar 3 etc. We keep
      // that behaviour (it matches user intuition "same day each month").
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
    if (cursor.getTime() > endDate.getTime()) break;
    out.push(new Date(cursor));
    if (out.length >= MAX_RECURRING_INSTANCES) break;
  }
  return out;
}

// =============================================================================
// Queries
// =============================================================================

/**
 * Classes for admin's /admin/clases view. Returns every class in a date
 * range, joined with teacher identity and participant list.
 */
export async function getClassesInRange(
  from: Date,
  to:   Date,
): Promise<ClassWithPeople[]> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("classes")
    .select(`
      id, type, teacher_id, scheduled_at, duration_minutes,
      recurrence_pattern, recurrence_end_date, parent_class_id,
      title, topic, status, livekit_room_id, is_trial,
      started_at, ended_at, actual_duration_minutes, notes_admin, created_at,
      teacher:teachers!inner(
        users!inner(email, full_name)
      ),
      class_participants(
        student_id, attended,
        student:students!inner(
          users!inner(email, full_name, phone)
        )
      )
    `)
    .gte("scheduled_at", from.toISOString())
    .lte("scheduled_at", to.toISOString())
    .order("scheduled_at", { ascending: true });

  if (error) throw error;
  return (data ?? []).map(normaliseClassRow);
}

/**
 * Upcoming classes for a given teacher — used by /profesor views.
 */
export async function getTeacherUpcomingClasses(
  teacherId: string,
  now = new Date(),
  horizonDays = 30,
): Promise<ClassWithPeople[]> {
  const to = new Date(now.getTime() + horizonDays * 24 * 3600 * 1000);
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("classes")
    .select(`
      id, type, teacher_id, scheduled_at, duration_minutes,
      recurrence_pattern, recurrence_end_date, parent_class_id,
      title, topic, status, livekit_room_id, is_trial,
      started_at, ended_at, actual_duration_minutes, notes_admin, created_at,
      teacher:teachers!inner(
        users!inner(email, full_name)
      ),
      class_participants(
        student_id, attended,
        student:students!inner(
          users!inner(email, full_name, phone)
        )
      )
    `)
    .eq("teacher_id", teacherId)
    .gte("scheduled_at", now.toISOString())
    .lte("scheduled_at", to.toISOString())
    .in("status", ["scheduled", "live"])
    .order("scheduled_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(normaliseClassRow);
}

/**
 * Upcoming classes for a given student.
 */
export async function getStudentUpcomingClasses(
  studentId: string,
  now = new Date(),
  horizonDays = 60,
): Promise<ClassWithPeople[]> {
  const to = new Date(now.getTime() + horizonDays * 24 * 3600 * 1000);
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("class_participants")
    .select(`
      class_id,
      class:classes!inner(
        id, type, teacher_id, scheduled_at, duration_minutes,
        recurrence_pattern, recurrence_end_date, parent_class_id,
        title, topic, status, livekit_room_id, is_trial,
        started_at, ended_at, actual_duration_minutes, notes_admin, created_at,
        teacher:teachers!inner(
          users!inner(email, full_name)
        ),
        class_participants(
          student_id, attended,
          student:students!inner(
            users!inner(email, full_name, phone)
          )
        )
      )
    `)
    .eq("student_id", studentId)
    .gte("class.scheduled_at", now.toISOString())
    .lte("class.scheduled_at", to.toISOString())
    .in("class.status", ["scheduled", "live"]);
  if (error) throw error;

  const rows = (data ?? [])
    .map((r: Record<string, unknown>) => {
      const c = r.class;
      return normaliseClassRow((Array.isArray(c) ? c[0] : c) as Record<string, unknown>);
    })
    .filter((c): c is ClassWithPeople => Boolean(c?.id))
    .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
  return rows;
}

/**
 * One class by id + everything attached to it.
 */
export async function getClassById(id: string): Promise<ClassWithPeople | null> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("classes")
    .select(`
      id, type, teacher_id, scheduled_at, duration_minutes,
      recurrence_pattern, recurrence_end_date, parent_class_id,
      title, topic, status, livekit_room_id, is_trial,
      started_at, ended_at, actual_duration_minutes, notes_admin, created_at,
      teacher:teachers!inner(
        users!inner(email, full_name)
      ),
      class_participants(
        student_id, attended,
        student:students!inner(
          users!inner(email, full_name, phone)
        )
      )
    `)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return normaliseClassRow(data);
}

// =============================================================================
// Mutations
// =============================================================================

/**
 * Cancel a class (single instance or whole series if `whole` is true).
 * Doesn't delete rows — sets status='cancelled' so the history is preserved.
 */
export async function cancelClass(
  classId: string,
  opts: { whole: boolean } = { whole: false },
): Promise<{ cancelledIds: string[] }> {
  const sb = supabaseAdmin();
  const { data: cls } = await sb
    .from("classes")
    .select("id, parent_class_id")
    .eq("id", classId)
    .maybeSingle();
  if (!cls) return { cancelledIds: [] };

  const ids: string[] = [];
  if (opts.whole && (cls as { parent_class_id: string | null }).parent_class_id) {
    // Cancel the whole series — every class that shares parent_class_id.
    const { data: siblings } = await sb
      .from("classes")
      .select("id")
      .eq("parent_class_id", (cls as { parent_class_id: string }).parent_class_id)
      .in("status", ["scheduled"]);
    for (const s of siblings ?? []) ids.push(s.id as string);
  } else {
    ids.push(classId);
  }

  if (ids.length === 0) return { cancelledIds: [] };

  const { error } = await sb
    .from("classes")
    .update({ status: "cancelled" })
    .in("id", ids)
    .eq("status", "scheduled");   // only cancel still-scheduled classes
  if (error) throw new Error(`cancel failed: ${error.message}`);

  return { cancelledIds: ids };
}

// =============================================================================
// Internal helpers
// =============================================================================

type RawClass = Record<string, unknown>;

function normaliseClassRow(r: RawClass): ClassWithPeople {
  const teacher = r.teacher as RawClass | RawClass[] | null;
  const teacherFlat = Array.isArray(teacher) ? teacher[0] : teacher;
  const tu = teacherFlat?.users as RawClass | RawClass[] | null;
  const tuFlat = Array.isArray(tu) ? tu[0] : tu;

  const participantsRaw = (r.class_participants as RawClass[] | undefined) ?? [];
  const participants = participantsRaw.map(p => {
    const student = p.student as RawClass | RawClass[] | null;
    const sFlat = Array.isArray(student) ? student[0] : student;
    const su = sFlat?.users as RawClass | RawClass[] | null;
    const suFlat = Array.isArray(su) ? su[0] : su;
    return {
      student_id:    p.student_id as string,
      student_name:  (suFlat?.full_name as string | null) ?? null,
      student_email: (suFlat?.email as string | undefined) ?? "",
      student_phone: (suFlat?.phone as string | null) ?? null,
      attended:      (p.attended as boolean | null) ?? null,
    };
  });

  return {
    id:                       r.id as string,
    type:                     r.type as ClassType,
    teacher_id:               r.teacher_id as string,
    scheduled_at:             r.scheduled_at as string,
    duration_minutes:         r.duration_minutes as number,
    recurrence_pattern:       r.recurrence_pattern as RecurrencePattern,
    recurrence_end_date:      (r.recurrence_end_date as string | null) ?? null,
    parent_class_id:          (r.parent_class_id as string | null) ?? null,
    title:                    r.title as string,
    topic:                    (r.topic as string | null) ?? null,
    status:                   r.status as ClassStatus,
    livekit_room_id:          r.livekit_room_id as string,
    is_trial:                 (r.is_trial as boolean | null) ?? false,
    started_at:               (r.started_at as string | null) ?? null,
    ended_at:                 (r.ended_at as string | null) ?? null,
    actual_duration_minutes:  (r.actual_duration_minutes as number | null) ?? null,
    notes_admin:              (r.notes_admin as string | null) ?? null,
    created_at:               r.created_at as string,
    teacher_name:             (tuFlat?.full_name as string | null) ?? null,
    teacher_email:            (tuFlat?.email as string | undefined) ?? "",
    participants,
  };
}

// =============================================================================
// Display helpers
// =============================================================================

export function formatClassDateEs(d: string | Date): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("es-ES", {
    weekday: "long", day: "numeric", month: "long",
    timeZone: "Europe/Berlin",
  });
}

export function formatClassTimeEs(d: string | Date): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleTimeString("es-ES", {
    hour: "2-digit", minute: "2-digit",
    timeZone: "Europe/Berlin",
  });
}

export function classStatusEs(status: ClassStatus): string {
  switch (status) {
    case "scheduled": return "Agendada";
    case "live":      return "En curso";
    case "completed": return "Completada";
    case "cancelled": return "Cancelada";
    case "absent":    return "No asistió";
  }
}
