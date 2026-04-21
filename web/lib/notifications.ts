import { supabaseAdmin } from "./supabase";

export type NotificationType =
  | "class_scheduled"
  // Legacy reminder windows — kept for backwards compatibility with
  // historical rows; new traffic uses class_reminder_30m only.
  | "class_reminder_24h"
  | "class_reminder_1h"
  | "class_reminder_15m"
  // Single consolidated pre-class reminder (email + in-app, ~30 min before).
  | "class_reminder_30m"
  | "class_cancelled"
  | "class_updated"
  | "class_starting"
  | "recording_ready"
  | "homework_new"
  | "homework_reviewed"
  | "generic";

export type NotificationRow = {
  id:         string;
  user_id:    string;
  type:       NotificationType;
  title:      string;
  body:       string;
  link:       string | null;
  class_id:   string | null;
  read_at:    string | null;
  created_at: string;
};

/**
 * Create an in-app notification. Returns the row id, or null if the
 * notifications table doesn't exist yet (migration 013 not applied).
 * Intentionally swallows that specific error so the class-create flow
 * doesn't fail during the migration rollout window.
 */
export async function createNotification(input: {
  user_id:  string;
  type:     NotificationType;
  title:    string;
  body:     string;
  link?:    string | null;
  class_id?: string | null;
}): Promise<string | null> {
  const sb = supabaseAdmin();
  const { data, error } = await sb.from("notifications").insert({
    user_id:   input.user_id,
    type:      input.type,
    title:     input.title,
    body:      input.body,
    link:      input.link ?? null,
    class_id:  input.class_id ?? null,
  }).select("id").single();

  if (error) {
    if (/relation .* does not exist|42P01/i.test(error.message)) return null;
    console.error("notifications insert failed:", error.message);
    return null;
  }
  return (data?.id as string) ?? null;
}

/**
 * Has a reminder of this type already been sent for this class?
 * Used by the cron to avoid double-sends.
 */
export async function reminderAlreadySent(
  userId:  string,
  classId: string,
  type:    NotificationType,
): Promise<boolean> {
  const sb = supabaseAdmin();
  const { data } = await sb
    .from("notifications")
    .select("id")
    .eq("user_id", userId)
    .eq("class_id", classId)
    .eq("type", type)
    .maybeSingle();
  return Boolean(data);
}

/**
 * Unread count for a user (bell icon badge).
 */
export async function getUnreadCount(userId: string): Promise<number> {
  const sb = supabaseAdmin();
  const { count, error } = await sb
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("read_at", null);
  if (error) return 0;
  return count ?? 0;
}

/**
 * Most recent notifications for a user (bell dropdown / notifications page).
 */
export async function listRecentNotifications(
  userId: string,
  limit = 20,
): Promise<NotificationRow[]> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("notifications")
    .select("id, user_id, type, title, body, link, class_id, read_at, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return [];
  return (data ?? []) as NotificationRow[];
}

/**
 * Mark every unread notification for a user as read. Called when they
 * open the bell dropdown or navigate to /notifications.
 */
export async function markAllRead(userId: string): Promise<number> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", userId)
    .is("read_at", null)
    .select("id");
  if (error) return 0;
  return (data ?? []).length;
}
