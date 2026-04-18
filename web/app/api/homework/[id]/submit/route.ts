import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { getStudentByUserId } from "@/lib/academy";

/**
 * POST /api/homework/[id]/submit
 *
 * Student submits (or re-submits) their answer to a homework assignment.
 * Upsert on (assignment_id, student_id) so re-submission replaces the
 * previous content — status resets to 'submitted' until the teacher
 * reviews again.
 */

const Body = z.object({
  content:     z.string().trim().max(10000).default(""),
  attachments: z.array(z.object({
    url:  z.string().url(),
    name: z.string().max(200),
  })).max(10).default([]),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = (session.user as { id: string }).id;

  const student = await getStudentByUserId(userId);
  if (!student) return NextResponse.json({ error: "not_a_student" }, { status: 403 });

  const { id } = await params;
  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed", details: parsed.error.flatten() }, { status: 400 });
  }

  if (!parsed.data.content.trim() && parsed.data.attachments.length === 0) {
    return NextResponse.json({ error: "empty_submission" }, { status: 400 });
  }

  const sb = supabaseAdmin();

  // Check the student is actually allowed to submit (is in the class).
  const { data: assignment } = await sb
    .from("homework_assignments")
    .select("id, class_id, teacher_id")
    .eq("id", id)
    .maybeSingle();
  if (!assignment) return NextResponse.json({ error: "assignment_not_found" }, { status: 404 });

  const { data: enrolled } = await sb
    .from("class_participants")
    .select("class_id")
    .eq("class_id", (assignment as { class_id: string }).class_id)
    .eq("student_id", student.id)
    .maybeSingle();
  if (!enrolled) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { error } = await sb.from("homework_submissions").upsert({
    assignment_id: id,
    student_id:    student.id,
    content:       parsed.data.content,
    attachments:   parsed.data.attachments,
    status:        "submitted",
    submitted_at:  new Date().toISOString(),
    reviewed_at:   null,
    teacher_feedback: null,
    grade:         null,
  }, { onConflict: "assignment_id,student_id" });

  if (error) {
    return NextResponse.json({ error: "upsert_failed", message: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
