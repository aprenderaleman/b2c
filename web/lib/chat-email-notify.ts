import { supabaseAdmin } from "./supabase";
import { sendChatMessageEmail } from "./email/send";
import type { ChatViewerRole } from "./chat-display";

/**
 * Aviso por email cuando alguien recibe un mensaje en el chat de la
 * plataforma (Gelfis 2026-10-30): alumnos, profes y admins por igual.
 *
 * Reglas:
 *  - Nunca al autor. Solo a participantes activos con email.
 *  - Máximo un email cada 30 min por (chat, destinatario): si llegan
 *    varios mensajes seguidos, el primero avisa y el resto se agrupa
 *    implícitamente (registro en chat_email_notices, migración 148).
 *  - Respeta users.notifications_opt_out (lo aplica sendRaw).
 *  - El email no dice quién escribió ni qué: solo "tienes un mensaje" y
 *    el botón al chat (Gelfis 2026-10-30).
 *  - Nunca rompe el envío del mensaje: todo error se loguea y ya.
 */
const DEBOUNCE_MIN = 30;
const PLATFORM_URL = (process.env.NEXT_PUBLIC_PLATFORM_URL || process.env.PLATFORM_URL || "https://b2c.aprender-aleman.de").replace(/\/$/, "");

type Role = Exclude<ChatViewerRole, undefined>;

export function chatPathFor(role: Role, chatId: string): string {
  const base = role === "student" ? "/estudiante/chats"
    : role === "teacher" ? "/profesor/chats"
    : role === "admin" || role === "superadmin" ? "/admin/chats"
    : "/chat";
  return `${PLATFORM_URL}${base}?chat=${chatId}`;
}

export function firstName(full: string | null, email: string): string {
  const parts = (full ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return email.split("@")[0];
  return parts.length <= 2 ? parts.join(" ") : parts[0];
}

export async function notifyChatMessageByEmail(args: {
  chatId: string; messageId: string; authorId: string; content: string; attachments?: unknown[] | null;
}): Promise<{ sent: number; skipped: number }> {
  const sb = supabaseAdmin();
  let sent = 0, skipped = 0;
  try {
    if (!args.content.trim() && (args.attachments?.length ?? 0) === 0) return { sent, skipped };
    const { data: parts } = await sb.from("chat_participants")
      .select("user_id, users!inner(full_name, email, role, active, language_preference)").eq("chat_id", args.chatId);
    const since = new Date(Date.now() - DEBOUNCE_MIN * 60_000).toISOString();

    for (const row of (parts ?? []) as Array<{ user_id: string; users: unknown }>) {
      if (row.user_id === args.authorId) continue;
      const u = (Array.isArray(row.users) ? row.users[0] : row.users) as
        { full_name: string | null; email: string; role: Role; active: boolean; language_preference: "es" | "de" | null } | undefined;
      if (!u || !u.active || !u.email) { skipped++; continue; }

      const { data: recent, error: recentErr } = await sb.from("chat_email_notices").select("id")
        .eq("chat_id", args.chatId).eq("user_id", row.user_id).gte("sent_at", since).limit(1);
      // Sin tabla (migración 148 pendiente) o error: no enviamos, para no
      // bombardear con un email por mensaje. Fail-closed.
      if (recentErr) { console.warn("[chat-email] debounce no disponible:", recentErr.message); skipped++; continue; }
      if ((recent ?? []).length > 0) { skipped++; continue; }

      const r = await sendChatMessageEmail(u.email, {
        name:     firstName(u.full_name, u.email),
        chatUrl:  chatPathFor(u.role, args.chatId),
        language: u.language_preference ?? "es",
      });
      if (r.ok) {
        sent++;
        await sb.from("chat_email_notices").insert({ chat_id: args.chatId, user_id: row.user_id, message_id: args.messageId });
      } else {
        skipped++;
        console.warn(`[chat-email] no enviado a ${u.email}: ${r.error}`);
      }
    }
  } catch (e) {
    console.error("[chat-email] fallo:", e instanceof Error ? e.message : e);
  }
  return { sent, skipped };
}

/**
 * Recordatorio manual de mensajes sin leer (Gelfis 2026-10-30): mismo
 * email "Tienes un mensaje nuevo" + botón al chat, para un participante
 * concreto. Sin debounce: lo dispara un admin a propósito.
 */
export async function sendUnreadChatReminder(chatId: string, userId: string): Promise<{ ok: boolean; error?: string; to?: string }> {
  const sb = supabaseAdmin();
  const { data: row } = await sb.from("chat_participants")
    .select("user_id, users!inner(full_name, email, role, active, language_preference)")
    .eq("chat_id", chatId).eq("user_id", userId).maybeSingle();
  if (!row) return { ok: false, error: "not_participant" };
  const u = (Array.isArray(row.users) ? row.users[0] : row.users) as { full_name: string | null; email: string; role: Role; active: boolean; language_preference: "es" | "de" | null };
  if (!u.active || !u.email) return { ok: false, error: "inactive_or_no_email" };
  const r = await sendChatMessageEmail(u.email, { name: firstName(u.full_name, u.email), chatUrl: chatPathFor(u.role, chatId), language: u.language_preference ?? "es" });
  if (r.ok) await sb.from("chat_email_notices").insert({ chat_id: chatId, user_id: userId, message_id: null });
  return r.ok ? { ok: true, to: u.email } : { ok: false, error: r.error, to: u.email };
}
