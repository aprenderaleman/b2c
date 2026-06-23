import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getTeacherByUserId } from "@/lib/academy";
import { disconnectTeacherGoogleCalendar } from "@/lib/google-calendar-oauth";

export async function POST() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const user = session.user as { id: string; role?: string };
  if (!user.role || !["teacher", "admin", "superadmin"].includes(user.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const teacher = await getTeacherByUserId(user.id);
  if (!teacher) {
    return NextResponse.json({ error: "no_teacher_profile" }, { status: 404 });
  }

  await disconnectTeacherGoogleCalendar(teacher.id);
  return NextResponse.json({ ok: true });
}
