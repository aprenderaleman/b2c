import { NextResponse, after } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { syncTeacherCalendarAfterReschedule } from "@/lib/teacher-calendar-sync";
import { createNotification } from "@/lib/notifications";
import {
  resolveStudentTeacher,
  isSlotStillFree,
  RESCHEDULE_CUTOFF_HOURS,
} from "@/lib/student-schedule";
import { formatClassDateEs, formatClassTimeEs } from "@/lib/classes";

/**
 * POST /api/student/schedule/[id]  { startIso }
 *
 * El alumno mueve UNA clase futura suya (fase 3 — Gelfis 2026-10-06).
 * Reglas: solo clases individuales no-trial en estado scheduled, hasta
 * 24 h antes del inicio original (después solo el profe), y el nuevo
 * horario debe estar libre según el motor (que ya exige 12 h de
 * antelación). Espejo GCal + notificación al profe en after().
 */

const Body = z.object({ startIso: z.string().datetime() });

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if ((session.user as { role?: string }).role !== "student") {
    return NextResponse.json({ error: "solo_estudiantes" }, { status: 403 });
  }
  const userId = (session.user as { id: string }).id;
  const { id: classId } = await params;

  let raw: unknown;
  try { raw = await req.json(); }
  catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed", details: parsed.error.flatten() }, { status: 400 });
  }
  const startIso = parsed.data.startIso;

  const sb = supabaseAdmin();
  const { data: stu } = await sb.from("students").select("id").eq("user_id", userId).maybeSingle();
  if (!stu) return NextResponse.json({ error: "no_student_profile" }, { status: 403 });
  const studentId = (stu as { id: string }).id;

  // La clase debe ser suya, individual, no-trial y futura en 'scheduled'.
  const { data: cls } = await sb
    .from("classes")
    .select("id, type, status, is_trial, teacher_id, scheduled_at, title, class_participants!inner(student_id)")
    .eq("id", classId)
    .eq("class_participants.student_id", studentId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!cls) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const c = cls as { type: string; status: string; is_trial: boolean; teacher_id: string; scheduled_at: string; title: string };

  if (c.is_trial) return NextResponse.json({ error: "trial_no_self_service" }, { status: 400 });
  if (c.type !== "individual") {
    return NextResponse.json(
      { error: "solo_individuales", message: "Las clases grupales las mueve tu profesor." },
      { status: 400 },
    );
  }
  if (c.status !== "scheduled") {
    return NextResponse.json({ error: "bad_status", message: "Esta clase ya no se puede mover." }, { status: 400 });
  }
  const hoursToClass = (new Date(c.scheduled_at).getTime() - Date.now()) / 3_600_000;
  if (hoursToClass < RESCHEDULE_CUTOFF_HOURS) {
    return NextResponse.json(
      { error: "too_late", message: `Solo puedes reagendar hasta ${RESCHEDULE_CUTOFF_HOURS} h antes de la clase. Escríbele a tu profesor por Mensajes.` },
      { status: 400 },
    );
  }

  // El nuevo horario debe estar libre para SU profe actual.
  const teacher = await resolveStudentTeacher(studentId);
  const teacherId = teacher?.teacherId ?? c.teacher_id;
  if (!(await isSlotStillFree(teacherId, startIso))) {
    return NextResponse.json(
      { error: "slot_taken", message: "Ese horario ya no está disponible. Elige otro." },
      { status: 409 },
    );
  }

  const { error } = await sb
    .from("classes")
    .update({ scheduled_at: startIso })
    .eq("id", classId);
  if (error) {
    if (/no_double_booking|duplicate key/i.test(error.message)) {
      return NextResponse.json(
        { error: "slot_taken", message: "Ese horario ya no está disponible. Elige otro." },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: "update_failed", message: error.message }, { status: 500 });
  }

  const whenEs = `${formatClassDateEs(startIso)} ${formatClassTimeEs(startIso)}`;
  after(() => Promise.allSettled([
    syncTeacherCalendarAfterReschedule([classId]),
    teacher ? createNotification({
      user_id:  teacher.teacherUserId,
      type:     "class_updated",
      title:    "Clase reagendada por el alumno",
      body:     `${c.title} → ${whenEs} (Berlín).`,
      link:     `/profesor/clases/${classId}`,
      class_id: classId,
    }) : Promise.resolve(null),
  ]));

  return NextResponse.json({ ok: true, classId, scheduledAt: startIso });
}
