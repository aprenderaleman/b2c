import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getTeacherByUserId } from "@/lib/academy";
import { resolveEffectiveUser } from "@/lib/impersonation";
import { supabaseAdmin } from "@/lib/supabase";
import { createNotification } from "@/lib/notifications";

/**
 * POST /api/teacher/classes/start-now
 *
 * On-demand class start. Teacher clicks "Iniciar clase ahora" on a
 * student's profile. We:
 *   1. Validate ownership (teacher must already teach this student —
 *      either via an existing class OR via a student_group assignment).
 *   2. Create a class row with status='live', scheduled_at=NOW(),
 *      started_at=NOW(), duration_minutes=60 (placeholder — the real
 *      duration is written to actual_duration_minutes when the
 *      teacher ends the class through the existing end-class flow).
 *   3. Insert class_participants for the student.
 *   4. Fire an in-app notification linking the student to /aula/{id}.
 *
 * Multiple parallel live classes are ALLOWED (Gelfis: a teacher may
 * run several live rooms at once if needed). The aula itself shows a
 * warning when the teacher already has another live session open.
 *
 * Honors admin impersonation: if the caller is an admin "viewing as"
 * a teacher, the class is created under THAT teacher's identity.
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

  // Honor admin impersonation: when Gelfis "views as Sabine", the class
  // must be created under Sabine's teacher_id, not Gelfis's user id.
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
  // student belongs to. Admins acting as themselves skip the check —
  // but when impersonating a teacher we DO enforce it so we don't
  // accidentally create a class nobody else would've been allowed to.
  const isAdmin = (role === "admin" || role === "superadmin") && !eff.impersonated;
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

  // NOTE: Parallel live classes are explicitly allowed (per Gelfis) —
  // a teacher may legitimately have multiple live rooms at once, e.g.
  // one with a colleague covering attendance. No guard here.

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
