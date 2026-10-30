/**
 * Alias de la cuenta de la academia en el chat (Gelfis 2026-10-30).
 *
 * La cuenta aprenderaleman2026@gmail.com es a la vez el superadmin de
 * Gelfis y la cuenta "academia" que escribe la bienvenida. Los alumnos
 * deben verla como el asistente Stiv, no como "Gelfis Horn"; profes y
 * admins la siguen viendo con su nombre real. Solo cambia la presentación,
 * nunca el dato en `users`.
 */
export const ACADEMY_CHAT_EMAIL = process.env.ACADEMY_CHAT_EMAIL ?? "aprenderaleman2026@gmail.com";
export const ASSISTANT_DISPLAY_NAME = "Stiv (Asistente)";

export type ChatViewerRole = "superadmin" | "admin" | "teacher" | "student" | "closer" | "setter" | undefined;

export function chatDisplayName(
  user: { full_name: string | null; email: string },
  viewerRole: ChatViewerRole,
): string | null {
  if (viewerRole === "student" && user.email.toLowerCase() === ACADEMY_CHAT_EMAIL.toLowerCase()) {
    return ASSISTANT_DISPLAY_NAME;
  }
  return user.full_name;
}
