import { supabaseAdmin } from "./supabase";

/**
 * Comisión (%) que aplica a un profe (Gelfis 2026-11-26).
 *
 * Fuente de verdad única para el motor de comisiones, el panel de
 * Ganancias, /admin/comisiones y el Acuerdo de Colaboración:
 *
 *   1. users.comision_pct (comisión ACORDADA, número libre) si no es NULL.
 *   2. Si no, la del rango (config_rangos: starter 5 · pro 10 · elite 12 · master 15).
 *
 * La columna users.comision_pct llega con la migración 165. Mientras no
 * esté aplicada, las lecturas caen al rango sin romper nada (el motor de
 * comisiones corre dentro del webhook de Stripe: no puede fallar por esto).
 */

export type TeacherRango = "starter" | "pro" | "elite" | "master";

export type TeacherCommission = {
  pct: number;
  rango: string;
  /** true si el % viene de un acuerdo particular (users.comision_pct), no del rango. */
  custom: boolean;
};

const DEFAULT_PCT = 5;

/** Normaliza un % escrito a mano: número entre 0 y 100 con máx. 2 decimales, o null. */
export function parseCommissionPct(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(String(raw).replace(",", ".").trim());
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return Math.round(n * 100) / 100;
}

/**
 * Rango que se guarda junto a una comisión libre. Solo sirve de etiqueta
 * (insignia, compatibilidad con el sistema de rangos): el % que se paga es
 * el acordado. Se elige el rango más alto cuyo % no supere el acordado.
 */
export function rangoForPct(pct: number): TeacherRango {
  if (pct >= 15) return "master";
  if (pct >= 12) return "elite";
  if (pct >= 10) return "pro";
  return "starter";
}

/** "8 %", "12,5 %" — para mostrar. */
export function formatPct(pct: number): string {
  return `${String(Math.round(pct * 100) / 100).replace(".", ",")} %`;
}

/** Elige el % efectivo a partir de los datos ya cargados. Pura, para tests. */
export function resolveCommission(input: { customPct: unknown; rango: string | null | undefined; rangoPct: number | null | undefined }): TeacherCommission {
  const rango = input.rango ?? "starter";
  const custom = parseCommissionPct(input.customPct);
  if (custom !== null) return { pct: custom, rango, custom: true };
  return { pct: input.rangoPct ?? DEFAULT_PCT, rango, custom: false };
}

/** Lee users.rango y users.comision_pct tolerando que la columna aún no exista. */
async function loadUserCommissionFields(userId: string): Promise<{ rango: string | null; customPct: unknown }> {
  const sb = supabaseAdmin();
  const full = await sb.from("users").select("rango, comision_pct").eq("id", userId).maybeSingle();
  if (!full.error) {
    const r = full.data as { rango: string | null; comision_pct: number | string | null } | null;
    return { rango: r?.rango ?? null, customPct: r?.comision_pct ?? null };
  }
  const basic = await sb.from("users").select("rango").eq("id", userId).maybeSingle();
  return { rango: (basic.data as { rango: string | null } | null)?.rango ?? null, customPct: null };
}

/** Comisión efectiva de un profe por su user_id. */
export async function getTeacherCommission(teacherUserId: string): Promise<TeacherCommission> {
  const sb = supabaseAdmin();
  const { rango, customPct } = await loadUserCommissionFields(teacherUserId);
  const { data: rangoRow } = await sb.from("config_rangos").select("comision_pct")
    .eq("rol", "teacher").eq("rango", rango ?? "starter").maybeSingle();
  return resolveCommission({ customPct, rango, rangoPct: (rangoRow as { comision_pct: number } | null)?.comision_pct ?? null });
}

/**
 * Comisión efectiva de varios profes a la vez (para /admin/comisiones).
 * Devuelve un mapa user_id → comisión. Tolera que la columna no exista.
 */
export async function getTeacherCommissions(userIds: string[]): Promise<Map<string, TeacherCommission>> {
  const out = new Map<string, TeacherCommission>();
  if (userIds.length === 0) return out;
  const sb = supabaseAdmin();
  const { data: rangos } = await sb.from("config_rangos").select("rango, comision_pct").eq("rol", "teacher");
  const rangoPct = new Map(((rangos ?? []) as Array<{ rango: string; comision_pct: number }>).map(r => [r.rango, r.comision_pct]));
  let rows: Array<{ id: string; rango: string | null; comision_pct?: number | string | null }> = [];
  const full = await sb.from("users").select("id, rango, comision_pct").in("id", userIds);
  if (!full.error) rows = (full.data ?? []) as typeof rows;
  else rows = (((await sb.from("users").select("id, rango").in("id", userIds)).data ?? []) as typeof rows);
  for (const r of rows) {
    out.set(r.id, resolveCommission({ customPct: r.comision_pct ?? null, rango: r.rango, rangoPct: rangoPct.get(r.rango ?? "starter") ?? null }));
  }
  return out;
}

/**
 * Fija (o quita, con null) la comisión acordada de un profe.
 * Devuelve un error legible si la migración 165 aún no está aplicada.
 */
export async function setTeacherCommissionPct(teacherUserId: string, pct: number | null): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabaseAdmin().from("users").update({ comision_pct: pct }).eq("id", teacherUserId);
  if (!error) return { ok: true };
  if (/comision_pct/.test(error.message)) return { ok: false, error: "Falta aplicar la migración 165 (columna users.comision_pct)." };
  return { ok: false, error: error.message };
}
