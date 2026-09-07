import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { createStudentNotesDoc, getTeacherEmail } from "@/lib/google-docs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (role !== "admin" && role !== "superadmin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id: studentId } = await params;
  const sb = supabaseAdmin();

  const { data: student } = await sb
    .from("students")
    .select("id, current_level, trial_teacher_id, users!inner(full_name)")
    .eq("id", studentId)
    .maybeSingle();
  if (!student) {
    return NextResponse.json({ error: "student_not_found" }, { status: 404 });
  }

  const s = student as {
    id: string; current_level: string | null; trial_teacher_id: string | null;
    users: { full_name: string | null } | Array<{ full_name: string | null }>;
  };
  const u = Array.isArray(s.users) ? s.users[0] : s.users;
  const studentName = u?.full_name ?? "Estudiante";
  const level = s.current_level ?? "A1";

  let teacherName = "Profesor";
  let teacherEmail: string | null = null;
  if (s.trial_teacher_id) {
    teacherEmail = await getTeacherEmail(s.trial_teacher_id);
    const { data: t } = await sb
      .from("teachers")
      .select("users!inner(full_name)")
      .eq("id", s.trial_teacher_id)
      .maybeSingle();
    if (t) {
      const tu = Array.isArray((t as any).users) ? (t as any).users[0] : (t as any).users;
      teacherName = tu?.full_name ?? "Profesor";
    }
  }

  const doc = await createStudentNotesDoc(studentName, level, teacherName, teacherEmail);
  if (!doc) {
    return NextResponse.json({ error: "doc_creation_failed" }, { status: 500 });
  }

  await sb.from("students").update({ document_url: doc.url }).eq("id", studentId);

  const { data: group } = await sb
    .from("student_group_members")
    .select("group_id")
    .eq("student_id", studentId)
    .maybeSingle();
  if (group) {
    await sb.from("student_groups")
      .update({ document_url: doc.url })
      .eq("id", (group as { group_id: string }).group_id);
  }

  return NextResponse.json({ ok: true, docUrl: doc.url, docId: doc.id });
}
