import { auth } from "@/lib/auth";
import { getImpersonation } from "@/lib/impersonation";
import { getStudentByUserId } from "@/lib/academy";

/**
 * Quién actúa en las APIs de la serie. Respeta "ver como estudiante" del
 * admin (cookie de impersonación) igual que requireRoleWithImpersonation en
 * las páginas: si no, el admin veía el widget de valorar pero la API le
 * devolvía 401 ("No se pudo guardar tu valoración", Gelfis 2026-10-28).
 */
export async function resolveSerieActor(): Promise<{ userId: string; role: string; student: { id: string } | null } | null> {
  const session = await auth();
  if (!session?.user) return null;
  const su = session.user as { id: string; role?: string };
  const imp = await getImpersonation();
  const canImpersonate = su.role === "admin" || su.role === "superadmin";
  const userId = canImpersonate && imp ? imp.target_id : su.id;
  const role = canImpersonate && imp ? imp.target_role : (su.role ?? "");
  const student = role === "student" ? await getStudentByUserId(userId) : null;
  return { userId, role, student: student ? { id: student.id } : null };
}
