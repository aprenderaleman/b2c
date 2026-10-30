import { supabaseAdmin } from "../supabase";

/**
 * Quién ve el botón "✨ Asistente". Sin ANTHROPIC_API_KEY no lo ve nadie
 * (el endpoint respondería 503). Abierto a los tres roles tras el E2E
 * del 2026-10-07; quitar un rol de la lista lo oculta sin tocar el endpoint.
 */
const ROLES_VISIBLES: ReadonlyArray<"admin" | "teacher" | "student"> = ["admin", "teacher", "student"];

export function asistenteVisible(rol: "admin" | "teacher" | "student"): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY) && ROLES_VISIBLES.includes(rol);
}

/** Idioma de la interfaz del asistente, según la preferencia del usuario. */
export async function asistenteLang(userId: string): Promise<"es" | "de"> {
  const { data } = await supabaseAdmin().from("users").select("language_preference").eq("id", userId).maybeSingle();
  return (data as { language_preference?: string } | null)?.language_preference === "de" ? "de" : "es";
}
