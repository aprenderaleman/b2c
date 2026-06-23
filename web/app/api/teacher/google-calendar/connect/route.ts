import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getTeacherByUserId } from "@/lib/academy";
import {
  googleCalendarOAuthConfigured,
  buildGoogleOAuthUrl,
  signState,
} from "@/lib/google-calendar-oauth";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const role = (session.user as { role?: string }).role;
  if (!role || !["teacher", "admin", "superadmin"].includes(role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  if (!googleCalendarOAuthConfigured()) {
    return NextResponse.json(
      { error: "Google Calendar OAuth not configured" },
      { status: 503 },
    );
  }

  const teacher = await getTeacherByUserId(session.user.id as string);
  if (!teacher) {
    return NextResponse.json({ error: "no_teacher_profile" }, { status: 403 });
  }

  const state = signState(teacher.id);
  const url = buildGoogleOAuthUrl(state);
  return NextResponse.redirect(url);
}
