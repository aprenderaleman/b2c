import { supabaseAdmin } from "./supabase";

/**
 * Copys editables desde system_config (CRM Closer F4, Gelfis 2026-11-25).
 * Gelfis redacta los textos definitivos sin deploy: edita la clave en
 * /admin/closers (o directamente en la tabla) y el panel la usa a los
 * 60s como mucho. Sin fila en system_config se usa el texto por defecto.
 *
 * Placeholders: {nombre} (nombre de pila del lead) y {enlace} (URL de
 * reagenda). Uno desconocido se deja tal cual para que se vea el error.
 */

const CACHE_MS = 60_000;
const _cache = new Map<string, { v: string | null; at: number }>();

export async function getConfigValue(key: string): Promise<string | null> {
  const hit = _cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.v;
  try {
    const sb = supabaseAdmin();
    const { data } = await sb
      .from("system_config")
      .select("value")
      .eq("key", key)
      .maybeSingle();
    const v = (data as { value: string | null } | null)?.value ?? null;
    _cache.set(key, { v, at: Date.now() });
    return v;
  } catch {
    return hit?.v ?? null;
  }
}

export function invalidateConfigCopys(): void {
  _cache.clear();
}

export function renderCopy(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (full, k: string) => vars[k] ?? full);
}

export const CLOSER_COPY_REAGENDA_KEY = "closer_copy_reagenda";

export const CLOSER_COPY_REAGENDA_DEFAULT = [
  "Hola {nombre} 👋",
  "",
  "Como hablamos, aquí tienes el enlace para elegir",
  "la nueva fecha de tu clase de prueba:",
  "👉 {enlace}",
  "",
  "Mientras antes agendes, más pronto sales con tu",
  "plan personalizado para tu meta con el alemán.",
].join("\n");

/** Copy de reagenda del closer: system_config o el default. */
export async function getCloserReagendaCopy(vars: { nombre: string; enlace: string }): Promise<string> {
  const tpl = (await getConfigValue(CLOSER_COPY_REAGENDA_KEY)) || CLOSER_COPY_REAGENDA_DEFAULT;
  return renderCopy(tpl, vars);
}
