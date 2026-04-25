/**
 * Access control + timing rules for live classrooms and recordings.
 *
 * The rules (spec):
 *   - Only users listed in class_participants can join
 *   - Only the assigned teacher can be host
 *   - Room opens 15 min BEFORE scheduled start
 *   - Room auto-closes 30 min AFTER scheduled end
 */

import { supabaseAdmin } from "./supabase";

export type AulaAccess =
  | { ok: true; role: "host" | "participant"; roomName: string; canEnterNow: boolean; opensAt: Date; closesAt: Date }
  | { ok: false; reason: "not_found" | "not_authorized" | "cancelled" };

/**
 * Variant for trial-class leads — they don't have a user row yet, so
 * the standard role-based gate doesn't apply. Caller has already
 * validated the magic-link cookie before invoking this.
 */
export async function authorizeTrialAulaAccess(
  classId: string,
  leadId:  string,
  now = new Date(),
): Promise<AulaAccess> {
  const sb = supabaseAdmin();
  const { data: cls } = await sb
    .from("classes")
    .select("id, status, scheduled_at, duration_minutes, livekit_room_id, is_trial, lead_id")
    .eq("id", classId)
    .maybeSingle();
  if (!cls) return { ok: false, reason: "not_found" };
  const c = cls as {
    status: string; scheduled_at: string; duration_minutes: number;
    livekit_room_id: string; is_trial: boolean; lead_id: string | null;
  };
  if (c.status === "cancelled")          return { ok: false, reason: "cancelled" };
  if (!c.is_trial || c.lead_id !== leadId) return { ok: false, reason: "not_authorized" };

  const scheduled = new Date(c.scheduled_at);
  const opensAt   = new Date(scheduled.getTime() - 15 * 60_000);
  const closesAt  = new Date(scheduled.getTime() + (c.duration_minutes + 30) * 60_000);
  return {
    ok:           true,
    role:         "participant",     // lead is never host
    roomName:     c.livekit_room_id,
    canEnterNow:  now >= opensAt && now <= closesAt,
    opensAt,
    closesAt,
  };
}

/**
 * Decide whether `userId` may enter the live classroom for `classId` right now.
 * Returns the LiveKit room id the caller should connect to, and when the room
 * window opens/closes, so the UI can render a countdown or a "closed" banner.
 */
export async function authorizeAulaAccess(
  classId: string,
  userId:  string,
  role:    "superadmin" | "admin" | "teacher" | "student",
  now = new Date(),
): Promise<AulaAccess> {
  const sb = supabaseAdmin();

  const { data: cls, error } = await sb
    .from("classes")
    .select(`
      id, status, scheduled_at, duration_minutes, livekit_room_id,
      teacher_id,
      teacher:teachers!inner(user_id)
    `)
    .eq("id", classId)
    .maybeSingle();
  if (error || !cls) return { ok: false, reason: "not_found" };
  if ((cls as { status: string }).status === "cancelled") {
    return { ok: false, reason: "cancelled" };
  }

  const scheduled = new Date((cls as { scheduled_at: string }).scheduled_at);
  const duration  = (cls as { duration_minutes: number }).duration_minutes;
  const opensAt   = new Date(scheduled.getTime() - 15 * 60_000);
  const closesAt  = new Date(scheduled.getTime() + (duration + 30) * 60_000);
  const canEnterNow = now >= opensAt && now <= closesAt;

  const roomName = (cls as { livekit_room_id: string }).livekit_room_id;
  const teacher = (cls as { teacher: unknown }).teacher;
  const tFlat = (Array.isArray(teacher) ? teacher[0] : teacher) as { user_id: string } | null;

  // Admins and superadmins can always join any room as observers (host
  // privileges reserved for the actual teacher though).
  if (role === "superadmin" || role === "admin") {
    return {
      ok: true,
      role: "participant",
      roomName,
      canEnterNow,
      opensAt,
      closesAt,
    };
  }

  // Teachers: must be THE teacher of this class.
  if (role === "teacher") {
    if (tFlat?.user_id === userId) {
      return { ok: true, role: "host", roomName, canEnterNow, opensAt, closesAt };
    }
    return { ok: false, reason: "not_authorized" };
  }

  // Students: must be in class_participants for this class.
  if (role === "student") {
    const { data: match } = await sb
      .from("class_participants")
      .select("class_id, students!inner(user_id)")
      .eq("class_id", classId);

    type Row = { class_id: string; students: { user_id: string } | Array<{ user_id: string }> };
    const enrolled = ((match ?? []) as unknown as Row[]).some(r => {
      const s = Array.isArray(r.students) ? r.students[0] : r.students;
      return s?.user_id === userId;
    });
    if (!enrolled) return { ok: false, reason: "not_authorized" };

    return { ok: true, role: "participant", roomName, canEnterNow, opensAt, closesAt };
  }

  return { ok: false, reason: "not_authorized" };
}

/**
 * Whether a given user can watch a recording. A student/teacher can watch
 * only the recordings of classes they participated in; admins see all.
 */
export async function canViewRecording(
  recordingId: string,
  userId:      string,
  role:        "superadmin" | "admin" | "teacher" | "student",
): Promise<{ ok: true; classId: string } | { ok: false }> {
  const sb = supabaseAdmin();
  const { data: rec } = await sb
    .from("recordings")
    .select("id, class_id, status")
    .eq("id", recordingId)
    .maybeSingle();
  if (!rec) return { ok: false };

  if (role === "superadmin" || role === "admin") {
    return { ok: true, classId: (rec as { class_id: string }).class_id };
  }

  // Reuse the aula access check: if you could be in the room, you can
  // watch the recording (even after the time window closes).
  const { data: cls } = await sb
    .from("classes")
    .select(`
      id,
      teacher:teachers!inner(user_id),
      class_participants!inner(
        students!inner(user_id)
      )
    `)
    .eq("id", (rec as { class_id: string }).class_id)
    .maybeSingle();
  if (!cls) return { ok: false };

  const teacher = (cls as { teacher: unknown }).teacher;
  const tFlat = (Array.isArray(teacher) ? teacher[0] : teacher) as { user_id: string } | null;
  if (role === "teacher" && tFlat?.user_id === userId) {
    return { ok: true, classId: (rec as { class_id: string }).class_id };
  }

  if (role === "student") {
    type Part = { students: { user_id: string } | Array<{ user_id: string }> };
    const parts = ((cls as { class_participants: Part[] }).class_participants ?? []);
    const mine = parts.some(p => {
      const s = Array.isArray(p.students) ? p.students[0] : p.students;
      return s?.user_id === userId;
    });
    if (mine) return { ok: true, classId: (rec as { class_id: string }).class_id };
  }

  return { ok: false };
}
