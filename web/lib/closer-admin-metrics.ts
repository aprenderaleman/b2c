import { supabaseAdmin } from "./supabase";
import { businessMsBetween } from "./semaforo";

/**
 * CRM Closer F6 (Gelfis 2026-11-25) — métricas de contacto por closer
 * para /admin/closers/[id]. Derivadas 100% de leads + acciones_closer:
 *
 *   asignados          leads con fecha_asignacion_closer en el rango
 *   contactados        de esos, con ≥1 acción del closer tras la asignación
 *   % contactados <24h primer contacto a menos de 24h reloj de la
 *                      asignación (el bono no espera: horas reales)
 *   velocidad          mediana de HORAS HÁBILES (08–22 Berlín, como el
 *                      setter) entre asignación y primer contacto
 *
 * El primer contacto usa occurred_at (hora real, F1) con created_at de
 * respaldo para filas históricas.
 */

export type CloserContactMetrics = {
  asignados: number;
  contactados: number;
  contactadosEn24h: number;
  /** null si no hay asignados en el rango */
  pctContactados24h: number | null;
  /** mediana en ms hábiles; null sin datos */
  velocidadMedianaMs: number | null;
};

const H = 3_600_000;

export async function getCloserContactMetrics(
  closerId: string,
  days: number,
): Promise<CloserContactMetrics> {
  const sb = supabaseAdmin();
  const since = new Date(Date.now() - days * 24 * H).toISOString();

  const { data: leadsData } = await sb
    .from("leads")
    .select("id, fecha_asignacion_closer")
    .eq("closer_id", closerId)
    .gte("fecha_asignacion_closer", since);

  const cohort = (leadsData ?? []) as Array<{ id: string; fecha_asignacion_closer: string }>;
  if (cohort.length === 0) {
    return { asignados: 0, contactados: 0, contactadosEn24h: 0, pctContactados24h: null, velocidadMedianaMs: null };
  }

  const { data: accionesData } = await sb
    .from("acciones_closer")
    .select("lead_id, occurred_at, created_at")
    .eq("closer_id", closerId)
    .in("lead_id", cohort.map((l) => l.id))
    .order("created_at", { ascending: true });

  // Primer contacto por lead (tras la asignación)
  const firstByLead = new Map<string, number>();
  const asignadoMs = new Map(cohort.map((l) => [l.id, new Date(l.fecha_asignacion_closer).getTime()]));
  for (const a of (accionesData ?? []) as Array<{ lead_id: string; occurred_at: string | null; created_at: string }>) {
    const ts = new Date(a.occurred_at ?? a.created_at).getTime();
    const asig = asignadoMs.get(a.lead_id);
    if (asig === undefined || ts < asig) continue;
    const prev = firstByLead.get(a.lead_id);
    if (prev === undefined || ts < prev) firstByLead.set(a.lead_id, ts);
  }

  let contactados = 0;
  let contactadosEn24h = 0;
  const deltasHabiles: number[] = [];
  for (const l of cohort) {
    const first = firstByLead.get(l.id);
    if (first === undefined) continue;
    contactados++;
    const asig = asignadoMs.get(l.id)!;
    if (first - asig <= 24 * H) contactadosEn24h++;
    deltasHabiles.push(businessMsBetween(asig, first));
  }

  deltasHabiles.sort((a, b) => a - b);
  const mediana = deltasHabiles.length === 0
    ? null
    : deltasHabiles.length % 2 === 1
      ? deltasHabiles[(deltasHabiles.length - 1) / 2]
      : (deltasHabiles[deltasHabiles.length / 2 - 1] + deltasHabiles[deltasHabiles.length / 2]) / 2;

  return {
    asignados: cohort.length,
    contactados,
    contactadosEn24h,
    pctContactados24h: Math.round((contactadosEn24h / cohort.length) * 100),
    velocidadMedianaMs: mediana,
  };
}

export function fmtVelocidad(ms: number | null): string {
  if (ms === null) return "—";
  const totalMin = Math.round(ms / 60_000);
  if (totalMin < 60) return `${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}
