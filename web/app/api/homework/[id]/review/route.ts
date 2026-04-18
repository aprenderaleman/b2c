import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { getTeacherByUserId } from "@/lib/academy";
import { createNotification } from "@/lib/notifications";

/**
 * POST /api/homework/[id]/review — teacher reviews ONE submission.
 * Body: { submissionId, status, teacherFeedback?, grade? }
 */
const Body = z.object({
  submissionId:    z.string().uuid(),
  status:          z.enum(["reviewed", "needs_revision"]),
  teacherFeedback: z.string().trim().max(4000).nullable().default(null),
  grade:           z.enum(["A", "B", "C", "D", "F"]).nullable().default(null),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const userId = (session.user as { id: string }).id;
  const role   = (session.user as { role: "superadmin" | "admin" | "teacher" | "student" }).role;

  const { id: assignmentId } = await params;
  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed", details: parsed.error.flatten() }, { status: 400 });
  }

  const sb = supabaseAdmin();

  // Only the owner teacher (or admin) can review.
  const { data: a } = await sb
    .from("homework_assignments")
    .select("id, teacher_id, class_id, title")
    .eq("id", assignmentId)
    .maybeSingle();
  if (!a) return NextResponse.json({ error: "assignment_not_found" }, { status: 404 });

  if (role === "teacher") {
    const me = await getTeacherByUserId(userId);
    if (!me || me.id !== (a as { teacher_id: string }).teacher_id) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  }

  const { data: sub } = await sb
    .from("homework_submissions")
    .select("id, student_id, assignment_id")
    .eq("id", parsed.data.submissionId)
    .eq("assignment_id", assignmentId)
    .maybeSingle();
  if (!sub) return NextResponse.json({ error: "submission_not_found" }, { status: 404 });

  const { error } = await sb
    .from("homework_submissions")
    .update({
      status:            parsed.data.status,
      teacher_feedback:  parsed.data.teacherFeedback,
      grade:             parsed.data.grade,
      reviewed_at:       new Date().toISOString(),
    })
    .eq("id", parsed.data.submissionId);
  if (error) {
    return NextResponse.json({ error: "update_failed", message: error.message }, { status: 500 });
  }

  // Notify the student.
  const { data: studentUser } = await sb
    .from("students")
    .select("user_id")
    .eq("id", (sub as { student_id: string }).student_id)
    .maybeSingle();
  const stuUserId = (studentUser as { user_id?: string } | null)?.user_id;
  if (stuUserId) {
    await createNotification({
      user_id:  stuUserId,
      type:     "homework_reviewed",
      title:    parsed.data.status === "needs_revision" ? "Tarea requiere revisión" : "Tarea revisada",
      body:     `${(a as { title: string }).title}${parsed.data.grade ? ` — Nota: ${parsed.data.grade}` : ""}`,
      link:     "/estudiante/tareas",
      class_id: (a as { class_id: string }).class_id,
    });
  }

  return NextResponse.json({ ok: true });
}
