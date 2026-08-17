/**
 * Observador del semáforo global (fase 3, Gelfis 2026-08-16).
 *
 * Recalcula el color de los leads activos y FOTOGRAFÍA los cambios en
 * semaforo_transitions (append-only). Regla de la casa: automatismos
 * notifican, humanos deciden — este módulo NUNCA ejecuta acciones
 * sobre leads, solo observa.
 *
 * Lo usan el cron /api/cron/semaforo-observer (cada 10 min, para los
 * umbrales de tiempo) y el tablero /admin/semaforo.
 */

import { supabaseAdmin } from "./supabase";
import { getSemaforoBatch, type SemaforoResult } from "./semaforo";

const D = 86_400_000;

/**
 * Universo de leads que el semáforo vigila: no archivados, con
 * actividad razonablemente reciente (120 días) o en un estado de
 * cierre vivo. Acotado a 1000 por pasada.
 */
export async function getActiveLeadIds(): Promise<string[]> {
  const sb = supabaseAdmin();
  const since = new Date(Date.now() - 120 * D).toISOString();
  const { data } = await sb
    .from("leads")
    .select("id, estado_cierre, status, created_at")
    .neq("status", "lost")
    .or(`created_at.gte.${since},estado_cierre.in.(activo,seguimiento_pactado,en_reactivacion)`)
    .order("created_at", { ascending: false })
    .limit(1000);
  return ((data ?? []) as Array<{ id: string; estado_cierre: string | null }>)
    .filter(l => l.estado_cierre !== "perdido")
    .map(l => l.id);
}

/** Semáforo de todos los leads activos, en lotes de 200. */
export async function getActiveSemaforos(): Promise<Map<string, SemaforoResult>> {
  const ids = await getActiveLeadIds();
  const out = new Map<string, SemaforoResult>();
  for (let i = 0; i < ids.length; i += 200) {
    const batch = await getSemaforoBatch(ids.slice(i, i + 200));
    for (const [k, v] of batch) out.set(k, v);
  }
  return out;
}

/**
 * Una pasada del observador: compara el color actual de cada lead
 * activo con su última transición registrada e inserta una fila por
 * cada cambio (color O regla). Devuelve contadores.
 */
export async function observeTransitions(): Promise<{
  scanned: number;
  changed: number;
  counts: Record<string, number>;
}> {
  const sb = supabaseAdmin();
  const semaforos = await getActiveSemaforos();
  const ids = [...semaforos.keys()];
  if (ids.length === 0) return { scanned: 0, changed: 0, counts: {} };

  // Última transición conocida por lead (en lotes para no exceder URL).
  const lastByLead = new Map<string, { color: string; regla: string | null }>();
  for (let i = 0; i < ids.length; i += 200) {
    const slice = ids.slice(i, i + 200);
    const { data } = await sb
      .from("semaforo_transitions")
      .select("lead_id, color, regla, detected_at")
      .in("lead_id", slice)
      .order("detected_at", { ascending: false })
      .limit(2000);
    for (const r of (data ?? []) as Array<{ lead_id: string; color: string; regla: string | null }>) {
      if (!lastByLead.has(r.lead_id)) lastByLead.set(r.lead_id, { color: r.color, regla: r.regla });
    }
  }

  const inserts: Array<Record<string, unknown>> = [];
  const counts: Record<string, number> = { rojo: 0, amarillo: 0, verde: 0, fuera: 0 };

  for (const [leadId, s] of semaforos) {
    counts[s.color] = (counts[s.color] ?? 0) + 1;
    const prev = lastByLead.get(leadId);
    if (!prev || prev.color !== s.color || prev.regla !== s.regla) {
      inserts.push({
        lead_id: leadId,
        prev_color: prev?.color ?? null,
        color: s.color,
        regla: s.regla,
        causa: s.causa,
        badge: s.badge,
      });
    }
  }

  // Cerrar episodios de leads que SALIERON del universo activo (se
  // marcaron perdidos/convertidos): si su última transición fue rojo y
  // nadie la cierra, ese episodio queda abierto para siempre e infla
  // "tiempo promedio en rojo". Se registra una transición 'fuera'.
  const { data: abiertos } = await sb
    .from("semaforo_transitions")
    .select("lead_id, color, detected_at")
    .eq("color", "rojo")
    .gte("detected_at", new Date(Date.now() - 90 * D).toISOString())
    .order("detected_at", { ascending: false })
    .limit(3000);

  const ultimoRojo = new Map<string, string>();
  for (const r of (abiertos ?? []) as Array<{ lead_id: string; detected_at: string }>) {
    if (!ultimoRojo.has(r.lead_id)) ultimoRojo.set(r.lead_id, r.detected_at);
  }
  const fueraDelUniverso = [...ultimoRojo.keys()].filter(id => !semaforos.has(id));

  for (let i = 0; i < fueraDelUniverso.length; i += 200) {
    const slice = fueraDelUniverso.slice(i, i + 200);
    // ¿Su transición más reciente sigue siendo la del rojo? (si ya hubo
    // una posterior de otro color, el episodio está cerrado)
    const { data: posteriores } = await sb
      .from("semaforo_transitions")
      .select("lead_id, color, detected_at")
      .in("lead_id", slice)
      .order("detected_at", { ascending: false })
      .limit(2000);
    const ultimaPorLead = new Map<string, string>();
    for (const r of (posteriores ?? []) as Array<{ lead_id: string; color: string }>) {
      if (!ultimaPorLead.has(r.lead_id)) ultimaPorLead.set(r.lead_id, r.color);
    }
    const cerrar = slice.filter(id => ultimaPorLead.get(id) === "rojo");
    if (cerrar.length > 0) {
      inserts.push(...cerrar.map(id => ({
        lead_id: id, prev_color: "rojo", color: "fuera",
        regla: "FUERA", causa: null,
        badge: "⚫ Salió del universo activo (perdido/convertido)",
      })));
    }
  }

  for (let i = 0; i < inserts.length; i += 500) {
    await sb.from("semaforo_transitions").insert(inserts.slice(i, i + 500));
  }

  return { scanned: semaforos.size, changed: inserts.length, counts };
}

/**
 * Tiempo promedio en rojo de los últimos N días — LA métrica de salud.
 * Un "episodio rojo" va desde la transición a rojo hasta la siguiente
 * transición a otro color (o hasta ahora si sigue rojo).
 */
export async function avgTimeInRed(days = 7): Promise<{
  avgMs: number | null;
  episodes: number;
  openReds: number;
}> {
  const sb = supabaseAdmin();
  const since = new Date(Date.now() - (days + 7) * D).toISOString();
  const { data } = await sb
    .from("semaforo_transitions")
    .select("lead_id, color, detected_at")
    .gte("detected_at", since)
    .order("detected_at", { ascending: true })
    .limit(10_000);

  const rows = (data ?? []) as Array<{ lead_id: string; color: string; detected_at: string }>;
  const openSince = new Map<string, number>();
  const cutoff = Date.now() - days * D;
  const durations: number[] = [];

  for (const r of rows) {
    const t = new Date(r.detected_at).getTime();
    if (r.color === "rojo") {
      if (!openSince.has(r.lead_id)) openSince.set(r.lead_id, t);
    } else {
      const start = openSince.get(r.lead_id);
      if (start !== undefined) {
        openSince.delete(r.lead_id);
        if (t >= cutoff) durations.push(t - start);  // episodio cerrado en ventana
      }
    }
  }
  // Rojos aún abiertos cuentan hasta ahora.
  const now = Date.now();
  let openReds = 0;
  for (const start of openSince.values()) {
    openReds++;
    durations.push(now - start);
  }

  if (durations.length === 0) return { avgMs: null, episodes: 0, openReds };
  const avgMs = durations.reduce((a, b) => a + b, 0) / durations.length;
  return { avgMs, episodes: durations.length, openReds };
}
