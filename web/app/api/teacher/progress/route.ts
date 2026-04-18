import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getTeacherByUserId } from "@/lib/academy";
import { setStudentSkillScore } from "@/lib/teacher-notes";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * PUT /api/teacher/progress
 * Body: { studentId, skill, score }
 *
 * Teacher updates one skill score for one of their students. Clamped 0-100.
 */
const Body = z.object({
  studentId: z.string().uuid(),
  skill:     z.enum(["speaking", "writing", "reading", "listening", "grammar", "vocabulary"]),
  score:     z.coerce.number().int().min(0).max(100),
});

export async function PUT(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const userId = (session.user as { id: string }).id;
  const role   = (session.user as { role: string }).role;
  if (role !== "teacher" && role !== "admin" && role !== "superadmin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed", details: parsed.error.flatten() }, { status: 400 });
  }

  // Teacher-gating: must teach this student.
  if (role === "teacher") {
    const me = await getTeacherByUserId(userId);
    if (!me) return NextResponse.json({ error: "no_teacher_profile" }, { status: 403 });
    const sb = supabaseAdmin();
    const { data: shared } = await sb
      .from("class_participants")
      .select("class_id, classes!inner(teacher_id)")
      .eq("student_id", parsed.data.studentId)
      .eq("classes.teacher_id", me.id)
      .limit(1);
    if (!shared || shared.length === 0) {
      return NextResponse.json({ error: "not_your_student" }, { status: 403 });
    }
  }

  try {
    await setStudentSkillScore({
      studentId: parsed.data.studentId,
      skill:     parsed.data.skill,
      score:     parsed.data.score,
      updatedBy: userId,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: "update_failed", message: e instanceof Error ? e.message : "unknown" },
      { status: 500 },
    );
  }
}
