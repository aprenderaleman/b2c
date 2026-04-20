import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getTeacherByUserId } from "@/lib/academy";
import { supabaseAdmin } from "@/lib/supabase";
import { createNotification } from "@/lib/notifications";

/**
 * POST /api/teacher/classes/start-now
 *
 * On-demand class start. Teacher clicks "Iniciar clase ahora" on a
 * student's profile. We:
 *   1. Validate ownership (teacher must already teach this student).
 *   2. Refuse if the teacher has ANY class already in status='live' —
 *      double-booking yourself into parallel live rooms is a mess.
 *   3. Create a class row with status='live', scheduled_at=NOW(),
 *      started_at=NOW(), duration_minutes=60 (placeholder — the real
 *      duration is written to actual_duration_minutes when the
 *      teacher ends the class through the existing end-class flow).
 *   4. Insert class_participants for the student.
 *   5. Fire an in-app notification linking the student to /aula/{id}.
 *
 * Returns { classId } — the client navigates to /aula/{classId}.
 */

export const runtime = "nodejs";

const Body = z.object({
  student_id: z.string().uuid(),
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

  let raw: unknown;
  try { raw = await req.json(); }
  catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed" }, { status: 400 });
  }
  const { student_id: studentId } = parsed.data;

  const sb = supabaseAdmin();

  // Ownership: teacher must either (a) share a past/future class with
  // the student OR (b) be the teacher of a student_group that the
  // student belongs to. Admins skip the check.
  const isAdmin = role === "admin" || role === "superadmin";
  if (!isAdmin) {
    const [classOwn, groupOwn] = await Promise.all([
      sb.from("classes")
        .select("id, class_participants!inner(student_id)")
        .eq("teacher_id", me.id)
        .eq("class_participants.student_id", studentId)
        .limit(1),
      sb.from("student_group_members")
        .select("student_id, group:student_groups!inner(teacher_id)")
        .eq("student_id", studentId)
        .eq("group.teacher_id", me.id)
        .limit(1),
    ]);
    const owns = (classOwn.data?.length ?? 0) > 0 || (groupOwn.data?.length ?? 0) > 0;
    if (!owns) {
      return NextResponse.json({
        error:   "student_not_yours",
        message: "No tienes este estudiante asignado. Pide al admin que te añada a su grupo.",
      }, { status: 403 });
    }
  }

  // Pull student + user row so we can build the title + notify.
  const { data: st } = await sb
    .from("students")
    .select("id, user_id, users!inner(full_name, email)")
    .eq("id", studentId)
    .maybeSingle();
  if (!st) return NextResponse.json({ error: "student_not_found" }, { status: 404 });
  const u = (st as { users: unknown }).users;
  const uu = (Array.isArray(u) ? u[0] : u) as { full_name: string | null; email: string };
  const studentUserId = (st as { user_id: string }).user_id;
  const studentName   = uu.full_name ?? uu.email;

  // Don't allow two parallel live classes for the same teacher.
  const { data: alreadyLive } = await sb
    .from("classes")
    .select("id, title")
    .eq("teacher_id", me.id)
    .eq("status", "live")
    .limit(1);
  if (alreadyLive && alreadyLive.length > 0) {
    return NextResponse.json({
      error:   "already_live",
      message: `Ya tienes otra clase en curso: "${(alreadyLive[0] as { title: string }).title}". Termínala antes de empezar otra.`,
      existingClassId: (alreadyLive[0] as { id: string }).id,
    }, { status: 409 });
  }

  // Create the class. scheduled_at=NOW(), started_at=NOW(), status=live.
  // duration_minutes is a placeholder — the real number lands in
  // actual_duration_minutes when the teacher ends the class.
  const now = new Date();
  const { data: cls, error: insErr } = await sb
    .from("classes")
    .insert({
      type:             "individual",
      teacher_id:       me.id,
      scheduled_at:     now.toISOString(),
      started_at:       now.toISOString(),
      duration_minutes: 60,
      title:            `Clase con ${studentName}`,
      topic:            null,
      status:           "live",
      notes_admin:      "on_demand",
    })
    .select("id, livekit_room_id")
    .single();
  if (insErr || !cls) {
    return NextResponse.json(
      { error: "create_failed", message: insErr?.message ?? "unknown" },
      { status: 500 },
    );
  }
  const classId = (cls as { id: string }).id;

  // Attach the student.
  await sb.from("class_participants").insert({
    class_id:           classId,
    student_id:         studentId,
    attended:           null,
    counts_as_session:  true,
  });

  // In-app notification — Gelfis explicitly did NOT want WhatsApp here.
  await createNotification({
    user_id:  studentUserId,
    type:     "class_starting",
    title:    `${session.user.name ?? "Tu profesor"} te espera en el aula`,
    body:     "Clase en curso ahora. Entra cuando puedas.",
    link:     `/aula/${classId}`,
    class_id: classId,
  }).catch(e => console.error("notify student failed:", e));

  return NextResponse.json({ ok: true, classId });
}
