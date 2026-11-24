import { supabaseAdmin } from "./supabase";
import { ensureDirectChat, sendMessage } from "./chat";
import { ACADEMY_CHAT_EMAIL } from "./chat-display";

/**
 * Bienvenida de Gelfis por el chat de la plataforma a cada profe nuevo, en
 * el momento de aprobarlo (Gelfis 2026-11-24). Es el equivalente al mensaje
 * de Stiv a los alumnos (lib/welcome-chat.ts): el profe se lo encuentra al
 * entrar por primera vez. Los profes ven la cuenta como "Gelfis", no como Stiv.
 *
 * El texto remite al "documento de bienvenida que te llegó por correo": por
 * eso solo se dispara desde la aprobación (/api/admin/teachers/[id]/approve),
 * cuyo email lleva la guía de primeros pasos. El alta manual de profes no
 * envía esa guía.
 *
 * Sin email de aviso: el profe acaba de recibir el email de bienvenida y
 * todavía no tiene contraseña. Idempotente: si la academia ya escribió en
 * ese chat, no se repite.
 */

export function renderTeacherWelcomeChat(fullName: string | null | undefined): string {
  const first = (fullName ?? "").trim().split(/\s+/)[0] || "";
  return [
    `¡Hola${first ? ` ${first}` : ""}! Soy Gelfis. Es un placer tenerte en el equipo de Aprender-Aleman.de 🎉`,
    `Revisa el documento de bienvenida que te llegó por correo, principalmente el guion para las clases de prueba, y avísame si te surge cualquier duda.`,
    `Estoy por aquí para lo que necesites.`,
    `— Gelfis`,
  ].join("\n\n");
}

export async function sendTeacherWelcomeChat(teacherUserId: string): Promise<{ ok: boolean; reason?: string }> {
  const sb = supabaseAdmin();
  const { data: admin } = await sb.from("users").select("id").eq("email", ACADEMY_CHAT_EMAIL).maybeSingle();
  const adminId = (admin as { id: string } | null)?.id;
  if (!adminId) return { ok: false, reason: "academy_user_not_found" };
  if (adminId === teacherUserId) return { ok: false, reason: "same_user" };

  const { data: u } = await sb.from("users").select("full_name, role").eq("id", teacherUserId).maybeSingle();
  const user = u as { full_name: string | null; role: string } | null;
  if (!user) return { ok: false, reason: "teacher_not_found" };
  if (user.role !== "teacher") return { ok: false, reason: "not_a_teacher" };

  const chatId = await ensureDirectChat(adminId, teacherUserId);
  const { data: prev } = await sb.from("messages").select("id").eq("chat_id", chatId).eq("author_id", adminId).eq("deleted", false).limit(1);
  if ((prev ?? []).length > 0) return { ok: true, reason: "already_sent" };

  const m = await sendMessage({ chatId, authorId: adminId, content: renderTeacherWelcomeChat(user.full_name), notifyEmail: false });
  return m ? { ok: true } : { ok: false, reason: "send_failed" };
}
