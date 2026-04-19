import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getTeacherByUserId } from "@/lib/academy";
import { createClass } from "@/lib/classes";
import { supabaseAdmin } from "@/lib/supabase";
import { wireChatsForClass } from "@/lib/chat";
import { createNotification } from "@/lib/notifications";
import { sendWhatsappText } from "@/lib/whatsapp";

/**
 * POST /api/teacher/classes
 *
 * Teacher self-service scheduling. Mirrors /api/admin/classes but:
 *   - Only callable with role=teacher (or admin as a safety hatch).
 *   - teacherId is FORCED to the caller's own teacher.id — can never
 *     schedule a class for someone else.
 *   - studentIds are validated: each must already share a class with
 *     the caller (i.e. students they actually teach). Prevents a
 *     teacher from scheduling with a random student.
 */

export const runtime = "nodejs";

const Body = z.object({
  type:              z.enum(["individual", "group"]),
  studentIds:        z.array(z.string().uuid()).min(1).max(20),
  scheduledAt:       z.string().datetime(),
  durationMinutes:   z.coerce.number().int().min(15).max(240),
  recurrencePattern: z.enum(["none", "weekly", "biweekly", "monthly"]).default("none"),
  recurrenceEndDate: z.string().date().nullable().default(null),
  title:             z.string().trim().min(2).max(200),
  topic:             z.string().trim().max(500).nullable().default(null),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const role = (session.user as { role?: string }).role;
  if (role !== "teacher" && role !== "admin" && role !== "superadmin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const me = await getTeacherByUserId((session.user as { id: string }).id);
  if (!me) {
    return NextResponse.json(
      { error: "no_teacher_profile", message: "Tu usuario no tiene perfil de profesor." },
      { status: 403 },
    );
  }

  let rawBody: unknown;
  try { rawBody = await req.json(); }
  catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }

  const parsed = Body.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_failed", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const body = parsed.data;

  if (body.type === "individual" && body.studentIds.length !== 1) {
    return NextResponse.json(
      { error: "validation_failed", message: "Una clase individual requiere exactamente 1 estudiante." },
      { status: 400 },
    );
  }
  if (body.recurrencePattern !== "none" && !body.recurrenceEndDate) {
    return NextResponse.json(
      { error: "validation_failed", message: "Define una fecha fin para la recurrencia." },
      { status: 400 },
    );
  }

  // Ownership check: each studentId must already be tied to me via
  // class_participants in at least one class I teach.
  const sb = supabaseAdmin();
  const { data: mineRows } = await sb
    .from("classes")
    .select("class_participants!inner(student_id)")
    .eq("teacher_id", me.id);
  const myStudentIds = new Set(
    ((mineRows ?? []) as Array<{ class_participants: Array<{ student_id: string }> }>)
      .flatMap(r => r.class_participants.map(cp => cp.student_id)),
  );
  const outsiders = body.studentIds.filter(id => !myStudentIds.has(id));
  if (outsiders.length > 0) {
    return NextResponse.json(
      { error: "student_not_yours",
        message: "Solo puedes agendar clases con estudiantes que ya son tuyos. Contacta con el admin para añadir estudiantes nuevos." },
      { status: 403 },
    );
  }

  let result;
  try {
    result = await createClass({
      type:              body.type,
      teacherId:         me.id,                       // forced to self
      studentIds:        body.studentIds,
      scheduledAt:       new Date(body.scheduledAt),
      durationMinutes:   body.durationMinutes,
      recurrencePattern: body.recurrencePattern,
      recurrenceEndDate: body.recurrenceEndDate ? new Date(body.recurrenceEndDate + "T23:59:59Z") : null,
      title:             body.title,
      topic:             body.topic,
      notesAdmin:        null,
      createdByUserId:   (session.user as { id?: string }).id ?? null,
    });
  } catch (e) {
    return NextResponse.json(
      { error: "create_failed", message: e instanceof Error ? e.message : "unknown" },
      { status: 500 },
    );
  }

  // Chats + notifications — same helpers the admin path uses.
  wireChatsForClass({
    classId:    result.parentId,
    type:       body.type,
    teacherId:  me.id,
    studentIds: body.studentIds,
    classTitle: body.title,
  }).catch(e => console.error("wireChatsForClass failed:", e));

  // Notify students only (teacher is the caller; they know).
  notifyStudentsOnCreation(result.ids[0], body.studentIds, body.title).catch(() => {});

  return NextResponse.json({
    ok:        true,
    parentId:  result.parentId,
    instances: result.ids.length,
  });
}

async function notifyStudentsOnCreation(
  firstClassId: string,
  studentIds:   string[],
  title:        string,
): Promise<void> {
  const sb = supabaseAdmin();
  const { data: cls } = await sb
    .from("classes").select("scheduled_at").eq("id", firstClassId).maybeSingle();
  if (!cls) return;
  const at = new Date((cls as { scheduled_at: string }).scheduled_at);
  const fmt = at.toLocaleString("es-ES", {
    weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
    timeZone: "Europe/Berlin",
  });

  const { data: studentRows } = await sb
    .from("students")
    .select("id, user_id, users!inner(phone, language_preference)")
    .in("id", studentIds);

  for (const s of studentRows ?? []) {
    const u = (s as { users: unknown }).users;
    const uu = (Array.isArray(u) ? u[0] : u) as
      | { phone: string | null; language_preference: "es" | "de" } | undefined;
    const userId = (s as { user_id: string }).user_id;
    if (uu?.phone) {
      await sendWhatsappText(uu.phone, `¡Tu clase está lista! 🎉\n\n${title}\n${fmt} (Berlín)\n\nTe enviaremos un recordatorio antes de que empiece.`);
    }
    if (userId) {
      await createNotification({
        user_id:  userId,
        type:     "class_scheduled",
        title:    "Nueva clase agendada",
        body:     `${title} — ${fmt}`,
        link:     `/estudiante/clases/${firstClassId}`,
        class_id: firstClassId,
      });
    }
  }
}
