import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isCloserGoogleCalendarConnected } from "@/lib/closer-google-calendar";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const user = session.user as { id: string; role?: string };
  if (!user.role || !["closer", "admin", "superadmin"].includes(user.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const status = await isCloserGoogleCalendarConnected(user.id);
  return NextResponse.json(status);
}
