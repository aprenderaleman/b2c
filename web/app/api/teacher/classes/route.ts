import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getTeacherByUserId } from "@/lib/academy";
import { resolveEffectiveUser } from "@/lib/impersonation";
import { createClass } from "@/lib/classes";
import { supabaseAdmin } from "@/lib/supabase";
import { wireChatsForClass } from "@/lib/chat";
import { createNotification } from "@/lib/notifications";
import { sendClassLifecycleEmail, lifecycleEmailsEnabled } from "@/lib/email/send";

const PLATFORM_URL = (process.env.PLATFORM_URL ?? "https://b2c.aprender-aleman.de").replace(/\/$/, "");

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

  // Honor admin impersonation: when "viewing as Sabine" the class is
  // created under Sabine's teacher_id, not the admin's user.
  const eff = await resolveEffectiveUser({
    fallbackUserId: (session.user as { id: string }).id,
    fallbackRole:   role as "teacher" | "admin" | "superadmin",
    expectRole:     "teacher",
  });
  const me = await getTeacherByUserId(eff.userId);
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

  // Ownership check: each studentId must be tied to me via (a) an
  // existing class_participants row OR (b) a student_group I'm the
  // assigned teacher of. Group-based ownership lets a teacher schedule
  // the very first class with a newly-assigned student.
  const sb = supabaseAdmin();
  const [mineRows, groupRows] = await Promise.all([
    sb.from("classes")
      .select("class_participants!inner(student_id)")
      .eq("teacher_id", me.id),
    sb.from("student_group_members")
      .select("student_id, group:student_groups!inner(teacher_id)")
      .eq("group.teacher_id", me.id),
  ]);
  const myStudentIds = new Set<string>();
  for (const r of (mineRows.data ?? []) as Array<{ class_participants: Array<{ student_id: string }> }>) {
    for (const cp of r.class_participants) myStudentIds.add(cp.student_id);
  }
  for (const r of (groupRows.data ?? []) as Array<{ student_id: string }>) {
    myStudentIds.add(r.student_id);
  }
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
    .from("classes")
    .select("scheduled_at, duration_minutes")
    .eq("id", firstClassId)
    .maybeSingle();
  if (!cls) return;
  const c = cls as { scheduled_at: string; duration_minutes: number };
  const at = new Date(c.scheduled_at);

  const { data: studentRows } = await sb
    .from("students")
    .select("id, user_id, users!inner(email, full_name, language_preference)")
    .in("id", studentIds);

  for (const s of studentRows ?? []) {
    const u = (s as { users: unknown }).users;
    const uu = (Array.isArray(u) ? u[0] : u) as
      | { email: string; full_name: string | null; language_preference: "es" | "de" }
      | undefined;
    const userId = (s as { user_id: string }).user_id;
    const lang = uu?.language_preference ?? "es";

    const fmt = at.toLocaleString(lang === "de" ? "de-DE" : "es-ES", {
      weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
      timeZone: "Europe/Berlin",
    });

    if (lifecycleEmailsEnabled() && uu?.email) {
      const first = (uu.full_name ?? "").trim().split(/\s+/)[0] || uu.email;
      sendClassLifecycleEmail(uu.email, {
        audience:      "student",
        kind:          "created",
        recipientName: first,
        classTitle:    title,
        startDate:     fmt + (lang === "de" ? " (Berlin)" : " (Berlín)"),
        durationMin:   c.duration_minutes,
        count:         1,
        classUrl:      `${PLATFORM_URL}/estudiante/clases/${firstClassId}`,
        language:      lang,
      }).catch(e => console.error("[teacher/classes] student email failed:", e));
    }
    if (userId) {
      await createNotification({
        user_id:  userId,
        type:     "class_scheduled",
        title:    lang === "de" ? "Neue Stunde agendiert" : "Nueva clase agendada",
        body:     `${title} — ${fmt}`,
        link:     `/estudiante/clases/${firstClassId}`,
        class_id: firstClassId,
      });
    }
  }
}
