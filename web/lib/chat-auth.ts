import { auth } from "./auth";
import { resolveEffectiveUser } from "./impersonation";

/**
 * Resuelve el usuario efectivo para las rutas de chat: normalmente el
 * de la sesión, pero si un admin está en "Ver como" (profesor o
 * estudiante) devuelve el user_id del target — así Gelfis puede ver y
 * probar los chats de cualquiera igual que el resto del panel.
 */
export async function resolveChatCaller(): Promise<{ userId: string } | null> {
  const session = await auth();
  if (!session?.user) return null;
  const userId = (session.user as { id: string }).id;
  const role   = (session.user as { role?: string }).role as
    "superadmin" | "admin" | "teacher" | "student" | "closer" | undefined;
  if (!role) return { userId };
  const eff = await resolveEffectiveUser({ fallbackUserId: userId, fallbackRole: role });
  return { userId: eff.userId };
}
