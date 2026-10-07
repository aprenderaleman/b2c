/**
 * Quién ve el botón "✨ Asistente". Sin ANTHROPIC_API_KEY no lo ve nadie
 * (el endpoint respondería 503). Despliegue por fases: de momento solo
 * admin; añadir "teacher" y "student" cuando pase la verificación E2E.
 * El endpoint /api/asistente ya acepta los tres roles.
 */
const ROLES_VISIBLES: ReadonlyArray<"admin" | "teacher" | "student"> = ["admin"];

export function asistenteVisible(rol: "admin" | "teacher" | "student"): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY) && ROLES_VISIBLES.includes(rol);
}
