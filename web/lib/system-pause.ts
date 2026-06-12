/**
 * Pausa global del sistema de mensajeria automatica.
 *
 * Cuando WhatsApp banea la instancia de Evolution (caso 2026-06-12,
 * ban de 5h), seguir disparando crons solo extiende el bloqueo. Este
 * helper lee `config.system_paused_until` de BD y permite a los crons
 * salir limpio sin tocar Evolution.
 *
 * Activacion:
 *   - Manual: UPDATE config SET value='<ISO>' WHERE key='system_paused_until'
 *   - Automatica (Python): webhook_server.py detecta error 5xx/rate y
 *     mete una pausa de 6h.
 *
 * Desactivacion:
 *   - Manual: DELETE FROM config WHERE key='system_paused_until'
 *   - Automatica: cuando el timestamp ya paso, devuelve false sin
 *     bloquear nada.
 */

import { supabaseAdmin } from "./supabase";

export type PauseStatus =
  | { paused: false }
  | { paused: true; until: string; reason?: string };

/** Lee el flag de pausa. Cachea 30s en memoria — los crons no llaman tantas veces. */
let _cache: { status: PauseStatus; ts: number } | null = null;
const CACHE_MS = 30_000;

export async function getSystemPauseStatus(): Promise<PauseStatus> {
  const now = Date.now();
  if (_cache && now - _cache.ts < CACHE_MS) return _cache.status;

  const sb = supabaseAdmin();
  const { data } = await sb
    .from("system_config")
    .select("value")
    .eq("key", "system_paused_until")
    .maybeSingle();

  const raw = (data as { value?: string } | null)?.value;
  if (!raw) {
    _cache = { status: { paused: false }, ts: now };
    return _cache.status;
  }

  const until = new Date(raw);
  if (Number.isNaN(until.getTime()) || until.getTime() <= now) {
    _cache = { status: { paused: false }, ts: now };
    return _cache.status;
  }

  const reasonRow = await sb
    .from("system_config")
    .select("value")
    .eq("key", "system_paused_reason")
    .maybeSingle();
  const reason = (reasonRow.data as { value?: string } | null)?.value;

  _cache = { status: { paused: true, until: raw, reason }, ts: now };
  return _cache.status;
}

/**
 * Activa la pausa global. Solo llamado desde el endpoint de admin o
 * desde el auto-detect cuando se sospecha un ban. Bumpa el cache.
 */
export async function pauseSystem(hours: number, reason: string): Promise<void> {
  const sb = supabaseAdmin();
  const until = new Date(Date.now() + hours * 3600_000).toISOString();
  await sb.from("system_config").upsert([
    { key: "system_paused_until", value: until },
    { key: "system_paused_reason", value: reason },
  ]);
  _cache = null;
}

export async function resumeSystem(): Promise<void> {
  const sb = supabaseAdmin();
  await sb.from("system_config").delete().eq("key", "system_paused_until");
  await sb.from("system_config").delete().eq("key", "system_paused_reason");
  _cache = null;
}
