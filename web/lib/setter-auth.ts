import { auth } from "./auth";
import { getImpersonation } from "./impersonation";

/**
 * Resuelve el setter efectivo para las APIs del módulo setter:
 *  - setter real → su propio user id + nombre
 *  - admin/superadmin con impersonación activa ("Ver como setter") →
 *    el setter impersonado, para que sus contactos queden registrados
 *    a su nombre igual que si fuera él
 * Devuelve null si el caller no está autorizado.
 */
export async function resolveSetterActor(): Promise<{ id: string; name: string } | null> {
  const session = await auth();
  if (!session?.user) return null;

  const role = (session.user as { role?: string }).role;
  const userId = (session.user as { id: string }).id;

  if (role === "setter") {
    return { id: userId, name: (session.user.name ?? session.user.email ?? "Setter") as string };
  }

  if (role === "admin" || role === "superadmin") {
    const imp = await getImpersonation();
    if (imp?.target_role === "setter") {
      return { id: imp.target_id, name: imp.target_name };
    }
  }

  return null;
}
