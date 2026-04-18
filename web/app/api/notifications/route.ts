import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getUnreadCount, listRecentNotifications } from "@/lib/notifications";

/**
 * GET /api/notifications
 *   → { items: Notification[], unread: number }
 *
 * GET /api/notifications?count=1
 *   → { unread: number }   (light-weight, used by the bell for polling)
 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = (session.user as { id: string }).id;

  const url = new URL(req.url);
  const onlyCount = url.searchParams.get("count") === "1";

  const unread = await getUnreadCount(userId);
  if (onlyCount) return NextResponse.json({ unread });

  const items = await listRecentNotifications(userId, 20);
  return NextResponse.json({ items, unread });
}
