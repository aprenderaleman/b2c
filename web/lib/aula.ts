/**
 * Access control + timing rules for live classrooms and recordings.
 *
 * The rules (spec, updated 2026-04-30):
 *   - Only users listed in class_participants can join
 *   - Only the assigned teacher can be host
 *   - Room opens 15 min BEFORE scheduled start
 *   - Room closes at scheduled_at + duration_minutes + 5 min grace
 *     → past that, the surface shows "Ver grabación →" instead.
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
    .select("id, status, scheduled_at, duration_minutes, livekit_room_id, is_trial, lead_id, deleted_at, sesion_closer_id")
    .eq("id", classId)
    .maybeSingle();
  if (!cls) return { ok: false, reason: "not_found" };
  const c = cls as {
    status: string; scheduled_at: string; duration_minutes: number;
    livekit_room_id: string; is_trial: boolean; lead_id: string | null;
    deleted_at: string | null; sesion_closer_id: string | null;
  };
  // Soft-delete guard: si un admin eliminó la clase, tratarla como
  // cancelada. Sin este check el lead entraba a un aula sin profe.
  if (c.deleted_at !== null)             return { ok: false, reason: "cancelled" };
  if (c.status === "cancelled")          return { ok: false, reason: "cancelled" };
  // Válido para trials y Sesiones de Plan (closer, 2026-08-13)
  if ((!c.is_trial && !c.sesion_closer_id) || c.lead_id !== leadId) return { ok: false, reason: "not_authorized" };

  // Trials: ventana más amplia que clases regulares — 15 min antes,
  // 20 min de grace tras terminar (Gelfis 2026-07-28: hemos perdido
  // varios leads que llegaban 6-10 min tarde por problemas de red /
  // permisos y el aula ya estaba cerrada). Las clases regulares
  // (authorizeAulaAccess) mantienen los +5 originales.
  const scheduled = new Date(c.scheduled_at);
  const opensAt   = new Date(scheduled.getTime() - 15 * 60_000);
  const closesAt  = new Date(scheduled.getTime() + (c.duration_minutes + 20) * 60_000);
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
  role:    "superadmin" | "admin" | "teacher" | "student" | "closer",
  now = new Date(),
): Promise<AulaAccess> {
  const sb = supabaseAdmin();

  const { data: cls, error } = await sb
    .from("classes")
    .select(`
      id, status, scheduled_at, duration_minutes, livekit_room_id,
      teacher_id, sesion_closer_id,
      teacher:teachers(user_id)
    `)
    .eq("id", classId)
    .maybeSingle();
  if (error || !cls) return { ok: false, reason: "not_found" };
  if ((cls as { status: string }).status === "cancelled") {
    return { ok: false, reason: "cancelled" };
  }

  const classStatus = (cls as { status: string }).status;
  const scheduled = new Date((cls as { scheduled_at: string }).scheduled_at);
  const duration  = (cls as { duration_minutes: number }).duration_minutes;
  const opensAt   = new Date(scheduled.getTime() - 15 * 60_000);
  const closesAt  = new Date(scheduled.getTime() + (duration + 5) * 60_000);
  // Live classes are always joinable — the teacher explicitly started
  // them, so the time window must not block anyone from entering.
  const canEnterNow = classStatus === "live" || (now >= opensAt && now <= closesAt);

  const roomName = (cls as { livekit_room_id: string }).livekit_room_id;
  const teacher = (cls as { teacher: unknown }).teacher;
  const tFlat = (Array.isArray(teacher) ? teacher[0] : teacher) as { user_id: string } | null;

  // Admins and superadmins can always join any room. Por defecto entran
  // como observers (NO host) en clases de otros profes — eso preserva
  // el rol pedagógico. PERO si además son el teacher asignado de ESTA
  // clase, deben entrar como host: si no, no se inicia la grabación
  // (RecordingAutoStart está gated a isHost) y pierden los controles
  // de profesor. Bug detectado 2026-05-07: Gelfis (superadmin) daba
  // sus propias trials y NINGUNA se grababa porque caía aquí como
  // participant antes de evaluar la rama "teacher" de abajo.
  if (role === "superadmin" || role === "admin") {
    const isAlsoTeacherOfThisClass = tFlat?.user_id === userId;
    return {
      ok: true,
      role: isAlsoTeacherOfThisClass ? "host" : "participant",
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

  // Closers: host de SU Sesión de Plan-Alemán (misma regla que el profe con
  // su clase — solo el closer asignado, 2026-08-13).
  if (role === "closer") {
    const sesionCloserId = (cls as { sesion_closer_id: string | null }).sesion_closer_id;
    if (sesionCloserId && sesionCloserId === userId) {
      return { ok: true, role: "host", roomName, canEnterNow, opensAt, closesAt };
    }
    return { ok: false, reason: "not_authorized" };
  }

  // Students: must be in class_participants for this class.
  if (role === "student") {
    const { data: match } = await sb
      .from("class_participants")
      .select("class_id, students(user_id)")
      .eq("class_id", classId);

    type Row = { class_id: string; students: { user_id: string } | Array<{ user_id: string }> | null };
    const enrolled = ((match ?? []) as unknown as Row[]).some(r => {
      if (!r.students) return false;
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
 *
 * Trial classes (is_trial=true) son confidenciales: solo el profesor
 * asignado y un superadmin pueden verlas. Los admins normales y los
 * alumnos no pueden — los participantes de un trial son leads, no
 * alumnos, así que para ellos esto no aplica.
 */
export async function canViewRecording(
  recordingId: string,
  userId:      string,
  role:        string,
): Promise<{ ok: true; classId: string } | { ok: false }> {
  const sb = supabaseAdmin();
  const { data: rec } = await sb
    .from("recordings")
    .select("id, class_id, status, shared_with_teachers")
    .eq("id", recordingId)
    .maybeSingle();
  if (!rec) return { ok: false };

  // Cargamos la clase ya con `is_trial` para todas las decisiones de abajo.
  const { data: cls } = await sb
    .from("classes")
    .select(`
      id, is_trial,
      teacher:teachers(user_id),
      class_participants(
        students(user_id)
      )
    `)
    .eq("id", (rec as { class_id: string }).class_id)
    .maybeSingle();
  if (!cls) return { ok: false };

  const isTrial = Boolean((cls as { is_trial: boolean }).is_trial);
  const teacher = (cls as { teacher: unknown }).teacher;
  const tFlat = (Array.isArray(teacher) ? teacher[0] : teacher) as { user_id: string } | null;

  // Trials: superadmin y el profesor asignado. Con el flag
  // shared_with_teachers (migración 109, formación interna) cualquier
  // profesor activo logueado también puede verla.
  if (isTrial) {
    if (role === "superadmin") {
      return { ok: true, classId: (rec as { class_id: string }).class_id };
    }
    if (role === "teacher" && tFlat?.user_id === userId) {
      return { ok: true, classId: (rec as { class_id: string }).class_id };
    }
    if (role === "teacher" && (rec as { shared_with_teachers?: boolean }).shared_with_teachers) {
      return { ok: true, classId: (rec as { class_id: string }).class_id };
    }
    return { ok: false };
  }

  // Clases normales: superadmin/admin ven todo.
  if (role === "superadmin" || role === "admin") {
    return { ok: true, classId: (rec as { class_id: string }).class_id };
  }

  if (role === "teacher" && tFlat?.user_id === userId) {
    return { ok: true, classId: (rec as { class_id: string }).class_id };
  }

  if (role === "student") {
    type Part = { students: { user_id: string } | Array<{ user_id: string }> | null };
    const parts = ((cls as { class_participants: Part[] }).class_participants ?? []);
    const mine = parts.some(p => {
      const s = Array.isArray(p.students) ? p.students[0] : p.students;
      return s?.user_id === userId;
    });
    if (mine) return { ok: true, classId: (rec as { class_id: string }).class_id };
  }

  return { ok: false };
}
