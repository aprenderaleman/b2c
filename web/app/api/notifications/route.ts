import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getUnreadCount, listRecentNotifications } from "@/lib/notifications";
import {
  listUnreadAdminNotifications, adminUnreadCount,
  type AdminNotification,
} from "@/lib/admin-notifications";

/**
 * GET /api/notifications
 *   → { items: Notification[], unread: number }
 *
 * GET /api/notifications?count=1
 *   → { unread: number }   (light-weight, used by the bell for polling)
 *
 * Para superadmin/admin se mergean DOS fuentes:
 *   1. Notificaciones personales del user (recordatorios de clase, etc.)
 *   2. Notificaciones del sistema admin (auto-pausas, recoveries,
 *      escalations) — desde la tabla notifications nueva.
 * El bell del header las muestra todas juntas — no necesitamos UI nueva.
 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = (session.user as { id: string }).id;
  const role   = (session.user as { role?: string }).role;
  const isAdmin = role === "superadmin" || role === "admin";

  const url = new URL(req.url);
  const onlyCount = url.searchParams.get("count") === "1";

  const personalUnread = await getUnreadCount(userId);
  const adminUnread = isAdmin ? await adminUnreadCount() : 0;
  const unread = personalUnread + adminUnread;
  if (onlyCount) return NextResponse.json({ unread });

  const personalItems = await listRecentNotifications(userId, 20);
  let adminItems: AdminNotification[] = [];
  if (isAdmin) {
    adminItems = await listUnreadAdminNotifications(20);
  }
  // Adaptamos las admin a la shape que el bell ya entiende.
  const adminMapped = adminItems.map(n => ({
    id:         `admin:${n.id}`,  // prefijo para distinguir en mark-read
    type:       n.type,
    title:      n.title,
    body:       n.body ?? "",
    link:       n.action_url ?? null,
    read_at:    n.read_at,
    created_at: n.created_at,
  }));
  // Items mezclados, ordenados por timestamp desc.
  const items = [...personalItems, ...adminMapped]
    .sort((a, b) => (a.created_at > b.created_at ? -1 : 1))
    .slice(0, 30);
  return NextResponse.json({ items, unread });
}
