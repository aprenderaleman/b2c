import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { markAllRead } from "@/lib/notifications";

/**
 * POST /api/notifications/read
 *
 * Marks every unread notification for the caller as read. Called when
 * the user opens the bell dropdown. Returns the count cleared.
 */
export async function POST() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = (session.user as { id: string }).id;
  const cleared = await markAllRead(userId);
  return NextResponse.json({ ok: true, cleared });
}
