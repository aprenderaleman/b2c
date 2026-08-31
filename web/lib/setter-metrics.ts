/**
 * Métricas del setter (Gelfis 2026-08-31). Todas derivadas de datos
 * existentes (lead_contacts + leads + classes) — cero campos manuales.
 *
 *   M1 contactados  — leads únicos + contactos totales del periodo.
 *   M2 rescatados   — no-show marcado → agendar_prueba del setter →
 *                     ¿asistió después? (los "sin marcar" no cuentan
 *                     hasta que alguien marca el no-show: conservador).
 *   M3 delta        — show-rate de citas resueltas del periodo CON
 *                     contacto del setter antes de la cita vs SIN.
 *                     Convención del funnel: cita pasada sin marcar = ausencia.
 *   Cobertura       — % de citas del periodo con algún contacto del
 *                     setter antes de la cita. El delta solo es
 *                     interpretable con cobertura alta.
 *   M4 velocidad    — mediana de horas HÁBILES (08–22 Berlín) entre el
 *                     (re)agendado y el primer contacto del setter.
 *   M5 ventas       — conversiones posteriores a un rescate del setter
 *                     (no-show → rescate → convertido). Informativa;
 *                     no toca comisiones.
 */

import { supabaseAdmin } from "./supabase";
import { businessMsBetween } from "./semaforo";

const H = 3_600_000;
const D = 24 * H;
const T = (iso: string) => new Date(iso).getTime();

export type SetterMetrics = {
  days: number;
  contactados: { leadsUnicos: number; contactosTotales: number };
  rescatados: { reagendados: number; asistieron: number };
  delta: {
    conContacto: { asistieron: number; total: number; ratePct: number | null };
    sinContacto: { asistieron: number; total: number; ratePct: number | null };
    deltaPts: number | null;
  };
  cobertura: { contactadas: number; totalCitas: number; pct: number | null };
  velocidad: { medianaHorasHabiles: number | null; muestras: number };
  ventas: number;
};

type SetterContact = { lead_id: string; action_type: string; occurred_at: string };

function pct(part: number, total: number): number | null {
  if (total === 0) return null;
  return Math.round((part / total) * 1000) / 10;
}

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export async function getSetterMetrics(days: number, setterId?: string): Promise<SetterMetrics> {
  const sb = supabaseAdmin();
  const now = Date.now();
  const fromIso = new Date(now - days * D).toISOString();
  const nowIso = new Date(now).toISOString();

  const winContactsQuery = () => {
    let q = sb.from("lead_contacts")
      .select("lead_id, action_type, occurred_at")
      .eq("actor_type", "setter");
    if (setterId) q = q.eq("actor_id", setterId);
    return q;
  };

  // ── Lote 1: contactos del periodo + cohortes de citas + bookings + conversiones ──
  const [winContactsRes, trialCohortRes, sesionCohortRes, bookedClassesRes, convertedRes] = await Promise.all([
    winContactsQuery()
      .gte("occurred_at", fromIso)
      .limit(5000),
    sb.from("leads")
      .select("id, trial_scheduled_at, trial_attended_at, trial_absent_at")
      .gte("trial_scheduled_at", fromIso)
      .lte("trial_scheduled_at", nowIso),
    sb.from("leads")
      .select("id, sesion_plan_at, trial_attended_at, trial_absent_at")
      .gte("sesion_plan_at", fromIso)
      .lte("sesion_plan_at", nowIso),
    sb.from("classes")
      .select("id, lead_id, notify_after_at, created_at")
      .not("lead_id", "is", null)
      .or("is_trial.eq.true,sesion_closer_id.not.is.null")
      .is("deleted_at", null)
      .gte("notify_after_at", fromIso)
      .limit(2000),
    sb.from("leads")
      .select("id, converted_at, trial_absent_at")
      .gte("converted_at", fromIso),
  ]);

  const winContacts = (winContactsRes.data ?? []) as SetterContact[];

  // M1 — contactados
  const leadsUnicos = new Set(winContacts.map(c => c.lead_id)).size;
  const contactosTotales = winContacts.length;

  // ── Universo de leads para las secuencias → contactos all-time del setter ──
  type CohortLead = {
    id: string;
    trial_scheduled_at?: string | null;
    sesion_plan_at?: string | null;
    trial_attended_at: string | null;
    trial_absent_at: string | null;
  };
  const trialCohort = (trialCohortRes.data ?? []) as CohortLead[];
  const sesionCohort = (sesionCohortRes.data ?? []) as CohortLead[];
  const bookedClasses = (bookedClassesRes.data ?? []) as Array<{
    id: string; lead_id: string; notify_after_at: string | null; created_at: string;
  }>;
  const converted = (convertedRes.data ?? []) as Array<{
    id: string; converted_at: string; trial_absent_at: string | null;
  }>;

  const rescateLeadIds = [...new Set(
    winContacts.filter(c => c.action_type === "agendar_prueba").map(c => c.lead_id),
  )];

  const unionLeadIds = [...new Set([
    ...rescateLeadIds,
    ...trialCohort.map(l => l.id),
    ...sesionCohort.map(l => l.id),
    ...bookedClasses.map(c => c.lead_id),
    ...converted.map(l => l.id),
  ])];

  const contactsByLead = new Map<string, SetterContact[]>();
  if (unionLeadIds.length > 0) {
    // Supabase limita el tamaño del .in() — troceamos por si acaso.
    const chunks: string[][] = [];
    for (let i = 0; i < unionLeadIds.length; i += 200) chunks.push(unionLeadIds.slice(i, i + 200));
    const results = await Promise.all(chunks.map(ids =>
      winContactsQuery()
        .in("lead_id", ids)
        .order("occurred_at", { ascending: true })
        .limit(5000),
    ));
    for (const r of results) {
      for (const c of (r.data ?? []) as SetterContact[]) {
        const arr = contactsByLead.get(c.lead_id) ?? [];
        arr.push(c);
        contactsByLead.set(c.lead_id, arr);
      }
    }
  }

  // ── M2 — rescatados: absent < agendar_prueba (en ventana) < attended ──
  let reagendados = 0;
  let rescatadosAsistieron = 0;
  if (rescateLeadIds.length > 0) {
    const { data } = await sb
      .from("leads")
      .select("id, trial_absent_at, trial_attended_at")
      .in("id", rescateLeadIds);
    for (const l of (data ?? []) as Array<{ id: string; trial_absent_at: string | null; trial_attended_at: string | null }>) {
      if (!l.trial_absent_at) continue;
      const absentMs = T(l.trial_absent_at);
      const rescates = (contactsByLead.get(l.id) ?? []).filter(c =>
        c.action_type === "agendar_prueba" &&
        T(c.occurred_at) > absentMs &&
        T(c.occurred_at) >= T(fromIso));
      if (rescates.length === 0) continue;
      reagendados++;
      const firstRescateMs = T(rescates[0].occurred_at);
      if (l.trial_attended_at && T(l.trial_attended_at) > firstRescateMs) {
        rescatadosAsistieron++;
      }
    }
  }

  // ── M3 + cobertura — citas resueltas del periodo, con/sin contacto previo ──
  // Un lead con trial Y sesión en el periodo cuenta una vez (su última cita).
  const citaByLead = new Map<string, { citaAt: string; attended: boolean }>();
  const addCita = (leadId: string, citaAt: string | null | undefined, attendedAt: string | null) => {
    if (!citaAt) return;
    const prev = citaByLead.get(leadId);
    if (prev && T(prev.citaAt) >= T(citaAt)) return;
    citaByLead.set(leadId, { citaAt, attended: !!attendedAt });
  };
  for (const l of trialCohort) addCita(l.id, l.trial_scheduled_at, l.trial_attended_at);
  for (const l of sesionCohort) addCita(l.id, l.sesion_plan_at, l.trial_attended_at);

  const grupo = { con: { asistieron: 0, total: 0 }, sin: { asistieron: 0, total: 0 } };
  for (const [leadId, cita] of citaByLead) {
    const citaMs = T(cita.citaAt);
    const contactado = (contactsByLead.get(leadId) ?? []).some(c => T(c.occurred_at) <= citaMs);
    const g = contactado ? grupo.con : grupo.sin;
    g.total++;
    if (cita.attended) g.asistieron++;
  }
  const conRate = pct(grupo.con.asistieron, grupo.con.total);
  const sinRate = pct(grupo.sin.asistieron, grupo.sin.total);

  // ── M4 — velocidad: mediana de horas hábiles agenda → primer contacto ──
  const deltasHoras: number[] = [];
  for (const cls of bookedClasses) {
    const bookedMs = T(cls.notify_after_at ?? cls.created_at);
    const first = (contactsByLead.get(cls.lead_id) ?? []).find(c => T(c.occurred_at) > bookedMs);
    if (!first) continue;
    deltasHoras.push(businessMsBetween(bookedMs, T(first.occurred_at)) / H);
  }
  const mediana = median(deltasHoras);

  // ── M5 — ventas originadas: no-show → rescate del setter → convertido ──
  let ventas = 0;
  for (const l of converted) {
    if (!l.trial_absent_at) continue;
    const absentMs = T(l.trial_absent_at);
    const convMs = T(l.converted_at);
    const rescato = (contactsByLead.get(l.id) ?? []).some(c =>
      c.action_type === "agendar_prueba" &&
      T(c.occurred_at) > absentMs &&
      T(c.occurred_at) < convMs);
    if (rescato) ventas++;
  }

  return {
    days,
    contactados: { leadsUnicos, contactosTotales },
    rescatados: { reagendados, asistieron: rescatadosAsistieron },
    delta: {
      conContacto: { asistieron: grupo.con.asistieron, total: grupo.con.total, ratePct: conRate },
      sinContacto: { asistieron: grupo.sin.asistieron, total: grupo.sin.total, ratePct: sinRate },
      deltaPts: conRate != null && sinRate != null
        ? Math.round((conRate - sinRate) * 10) / 10
        : null,
    },
    cobertura: {
      contactadas: grupo.con.total,
      totalCitas: grupo.con.total + grupo.sin.total,
      pct: pct(grupo.con.total, grupo.con.total + grupo.sin.total),
    },
    velocidad: {
      medianaHorasHabiles: mediana != null ? Math.round(mediana * 10) / 10 : null,
      muestras: deltasHoras.length,
    },
    ventas,
  };
}
