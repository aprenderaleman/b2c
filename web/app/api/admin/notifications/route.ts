import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  listUnreadAdminNotifications, listRecentAdminNotifications,
  markAdminNotificationsRead, markAllAdminNotificationsRead,
  adminUnreadCount,
} from "@/lib/admin-notifications";

/**
 * GET /api/admin/notifications?mode=unread|recent&limit=20
 *   Lista de notifs (unread por defecto) + contador unread total.
 *
 * PATCH /api/admin/notifications
 *   Body: { ids: string[] }  → marca esos como leídos
 *   Body: { all: true }      → marca todos como leídos
 */

async function requireAdmin() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const role = (session.user as { role?: string }).role;
  if (role !== "superadmin" && role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  return null;
}

export async function GET(req: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const url = new URL(req.url);
  const mode = url.searchParams.get("mode") === "recent" ? "recent" : "unread";
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? 20)));
  const [items, unread] = await Promise.all([
    mode === "recent" ? listRecentAdminNotifications(limit) : listUnreadAdminNotifications(limit),
    adminUnreadCount(),
  ]);
  return NextResponse.json({ items, unread });
}

export async function PATCH(req: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  let body: { ids?: string[]; all?: boolean } = {};
  try { body = await req.json(); } catch { /* empty body is OK for {all:true} mode */ }
  if (body.all === true) {
    const n = await markAllAdminNotificationsRead();
    return NextResponse.json({ ok: true, marked_read: n });
  }
  if (Array.isArray(body.ids) && body.ids.length > 0) {
    const n = await markAdminNotificationsRead(body.ids);
    return NextResponse.json({ ok: true, marked_read: n });
  }
  return NextResponse.json({ error: "missing_ids_or_all" }, { status: 400 });
}
