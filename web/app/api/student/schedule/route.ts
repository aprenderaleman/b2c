import { NextResponse, after } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { createClass } from "@/lib/classes";
import { getClassBalance } from "@/lib/class-balance";
import { listTeacherClassSlots } from "@/lib/trial-slots";
import { mirrorClassesToTeacherCalendar } from "@/lib/teacher-calendar-sync";
import { createNotification } from "@/lib/notifications";
import {
  resolveStudentTeacher,
  isSlotStillFree,
  STUDENT_CLASS_MINUTES,
} from "@/lib/student-schedule";

/**
 * Agendado self-service del alumno (fase 3 — Gelfis 2026-10-06).
 *
 *   GET  /api/student/schedule  → huecos libres de SU profe + saldo
 *   POST /api/student/schedule  → { startIso } agenda una clase individual
 *
 * Reglas: 12h de antelación (motor), saldo (createClass/canBookClass),
 * solo individual con su profe. Espejo GCal + notificación al profe en
 * after().
 */

async function resolveStudent(): Promise<
  | { ok: true; studentId: string; userId: string; name: string }
  | { ok: false; res: NextResponse }
> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, res: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }
  const role = (session.user as { role?: string }).role;
  if (role !== "student") {
    return { ok: false, res: NextResponse.json({ error: "solo_estudiantes" }, { status: 403 }) };
  }
  const userId = (session.user as { id: string }).id;
  const sb = supabaseAdmin();
  const { data: stu } = await sb.from("students").select("id").eq("user_id", userId).maybeSingle();
  if (!stu) {
    return { ok: false, res: NextResponse.json({ error: "no_student_profile" }, { status: 403 }) };
  }
  return {
    ok: true,
    studentId: (stu as { id: string }).id,
    userId,
    name: session.user.name ?? session.user.email ?? "Estudiante",
  };
}

export async function GET() {
  const me = await resolveStudent();
  if (!me.ok) return me.res;

  const teacher = await resolveStudentTeacher(me.studentId);
  if (!teacher) {
    return NextResponse.json({ error: "sin_profesor", message: "Aún no tienes profesor asignado — escríbenos y lo resolvemos." }, { status: 409 });
  }
  const [slots, balance] = await Promise.all([
    listTeacherClassSlots(teacher.teacherId),
    getClassBalance(me.studentId),
  ]);
  return NextResponse.json({
    teacherName: teacher.teacherName,
    disponibles: balance.disponibles,
    slots: slots.map(s => s.startIso),
  });
}

const PostBody = z.object({ startIso: z.string().datetime() });

export async function POST(req: Request) {
  const me = await resolveStudent();
  if (!me.ok) return me.res;

  let raw: unknown;
  try { raw = await req.json(); }
  catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = PostBody.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed", details: parsed.error.flatten() }, { status: 400 });
  }
  const startIso = parsed.data.startIso;

  const teacher = await resolveStudentTeacher(me.studentId);
  if (!teacher) {
    return NextResponse.json({ error: "sin_profesor" }, { status: 409 });
  }

  // El hueco debe seguir libre (motor = disponibilidad − clases −
  // bloqueos − GCal, con 12h de antelación incluida).
  if (!(await isSlotStillFree(teacher.teacherId, startIso))) {
    return NextResponse.json(
      { error: "slot_taken", message: "Ese horario ya no está disponible. Elige otro." },
      { status: 409 },
    );
  }

  const firstName = me.name.split(/\s+/)[0] || me.name;
  try {
    const { ids } = await createClass({
      type:              "individual",
      teacherId:         teacher.teacherId,
      studentIds:        [me.studentId],
      scheduledAt:       new Date(startIso),
      durationMinutes:   STUDENT_CLASS_MINUTES,
      recurrencePattern: "none",
      recurrenceEndDate: null,
      title:             `Clase de alemán — ${firstName}`,
      topic:             null,
      notesAdmin:        null,
      createdByUserId:   me.userId,
    });
    const classId = ids[0];

    after(() => Promise.allSettled([
      mirrorClassesToTeacherCalendar(ids),
      createNotification({
        user_id:  teacher.teacherUserId,
        type:     "class_scheduled",
        title:    "Nueva clase agendada",
        body:     `${me.name} agendó una clase contigo (reserva self-service).`,
        link:     `/profesor/clases/${classId}`,
        class_id: classId,
      }),
    ]));

    return NextResponse.json({ ok: true, classId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    if (/balance|saldo|exceeded|sin clases/i.test(msg)) {
      return NextResponse.json(
        { error: "sin_saldo", message: "No te quedan clases disponibles para agendar en tu plan." },
        { status: 409 },
      );
    }
    if (/no_double_booking|duplicate key/i.test(msg)) {
      return NextResponse.json(
        { error: "slot_taken", message: "Ese horario ya no está disponible. Elige otro." },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: "create_failed", message: msg }, { status: 500 });
  }
}
