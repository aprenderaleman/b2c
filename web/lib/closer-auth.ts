import { auth } from "./auth";
import { getImpersonation } from "./impersonation";

/**
 * Resuelve el closer efectivo para las APIs del módulo closer:
 *  - closer real → su propio user id + nombre
 *  - admin/superadmin con impersonación activa ("Ver como closer") →
 *    el closer impersonado, para que las acciones operen sobre sus
 *    leads/tareas igual que si fuera él
 * Devuelve null si el caller no está autorizado.
 */
export async function resolveCloserActor(): Promise<{ id: string; name: string } | null> {
  const session = await auth();
  if (!session?.user) return null;

  const role = (session.user as { role?: string }).role;
  const userId = (session.user as { id: string }).id;

  if (role === "closer") {
    return { id: userId, name: (session.user.name ?? session.user.email ?? "Closer") as string };
  }

  if (role === "admin" || role === "superadmin") {
    const imp = await getImpersonation();
    if (imp?.target_role === "closer") {
      return { id: imp.target_id, name: imp.target_name };
    }
  }

  return null;
}
