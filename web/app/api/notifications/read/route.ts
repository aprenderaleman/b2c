import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { markAllRead } from "@/lib/notifications";
import { markAllAdminNotificationsRead } from "@/lib/admin-notifications";

/**
 * POST /api/notifications/read
 *
 * Marks every unread notification for the caller as read. Called when
 * the user opens the bell dropdown. Returns the count cleared.
 *
 * Para superadmin/admin marca también las notifs del sistema (auto-pause,
 * recoveries, etc.) — ambas tablas en paralelo.
 */
export async function POST() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = (session.user as { id: string }).id;
  const role   = (session.user as { role?: string }).role;
  const isAdmin = role === "superadmin" || role === "admin";

  const [personal, admin] = await Promise.all([
    markAllRead(userId),
    isAdmin ? markAllAdminNotificationsRead() : Promise.resolve(0),
  ]);
  return NextResponse.json({ ok: true, cleared: personal + admin });
}
