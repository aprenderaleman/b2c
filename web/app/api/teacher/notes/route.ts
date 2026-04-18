import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getTeacherByUserId } from "@/lib/academy";
import { createTeacherNote } from "@/lib/teacher-notes";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * POST /api/teacher/notes — create a note about a student.
 * Teacher can only note students they've actually taught (there's at least
 * one class with that pairing in class_participants).
 */
const Body = z.object({
  studentId: z.string().uuid(),
  classId:   z.string().uuid().nullable().default(null),
  noteType:  z.enum(["class_summary", "progress", "behavior", "general"]).default("general"),
  content:   z.string().trim().min(3).max(4000),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const userId = (session.user as { id: string }).id;
  const role   = (session.user as { role: string }).role;
  if (role !== "teacher") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const me = await getTeacherByUserId(userId);
  if (!me) return NextResponse.json({ error: "no_teacher_profile" }, { status: 403 });

  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed", details: parsed.error.flatten() }, { status: 400 });
  }

  // Verify the teacher actually teaches this student (at least one shared class).
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

  try {
    await createTeacherNote({
      teacherId: me.id,
      studentId: parsed.data.studentId,
      classId:   parsed.data.classId,
      noteType:  parsed.data.noteType,
      content:   parsed.data.content,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: "insert_failed", message: e instanceof Error ? e.message : "unknown" },
      { status: 500 },
    );
  }
}
