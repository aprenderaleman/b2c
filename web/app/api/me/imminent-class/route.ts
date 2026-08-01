import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { getTeacherByUserId, getStudentByUserId } from "@/lib/academy";
import {
  getImminentClassForTeacher,
  getImminentClassForStudent,
} from "@/lib/imminent-class";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (!session?.user || !role) {
    return NextResponse.json({ imminent: null });
  }

  const userId = (session.user as { id: string }).id;
  let imminent = null;

  if (role === "teacher" || role === "admin" || role === "superadmin") {
    const teacher = await getTeacherByUserId(userId);
    if (teacher) imminent = await getImminentClassForTeacher(teacher.id);
  }

  if (!imminent && (role === "student" || role === "admin" || role === "superadmin")) {
    const student = await getStudentByUserId(userId);
    if (student) imminent = await getImminentClassForStudent(student.id);
  }

  return NextResponse.json({ imminent }, {
    headers: { "Cache-Control": "private, max-age=30" },
  });
}
