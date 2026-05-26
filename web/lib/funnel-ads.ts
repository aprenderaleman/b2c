/**
 * Queries para /admin/ads — dashboard de optimización del funnel.
 *
 * Estructura post-2026-05-26 (quiz simplificado de 5 a 2 preguntas):
 *   Paso 1 (motivo)  →  Paso 2 (nivel)  →  Paso 3 (datos)  →  Paso 4 (trial)
 *
 * Internamente en la BD `funnel_progress.step` y `leads` seguimos
 * usando 1, 2, 6, 7 para preservar la numeración histórica (los rows
 * antiguos pre-simplificación llevaban steps 3/4/5 que ya no existen).
 * Esta capa traduce los step internos a un embudo visual de 4 pasos.
 *
 * Fuentes:
 *   1. funnel_progress — telemetría granular por sesión y paso. Activa
 *      desde 2026-05-26.
 *   2. lead_motivo_inicial — registro histórico del paso 1, anterior
 *      al lanzamiento de funnel_progress.
 *   3. leads (source='diagnostico') — ground truth de los pasos 3 y 4
 *      (datos enviados y trial agendada respectivamente).
 */

import { supabaseAdmin } from "./supabase";

// ── Tipos ─────────────────────────────────────────────────────────

export type FunnelStepStats = {
  position:       number;          // 1..4 (posición visual en el embudo)
  internal_step:  number;          // 1, 2, 6, 7 (step real en funnel_progress)
  label:          string;
  reached:        number;
  drop_from_prev: number | null;   // % que abandonan vs paso anterior
  pct_of_entry:   number;          // % del paso 1 (entrada) que llegan aquí
};

export type AnswerBucket = {
  position:    number;
  step_label:  string;
  answer:      string;
  count:       number;
  pct:         number;
};

export type FunnelAlert = {
  severity: "high" | "medium" | "low";
  title:    string;
  detail:   string;
};

export type MotivoBreakdownRow = {
  motivo:     string;
  sessions:   number;
  reached_datos:  number;
  pct_datos:      number;
  reached_trial:  number;
  pct_trial:      number;
  converted:  number;
};

export type FunnelAdsData = {
  days:        number;
  steps:       FunnelStepStats[];
  // Sólo hay respuestas medibles en los pasos del quiz (posiciones 1 y 2).
  // Los pasos 3 (datos) y 4 (trial) no tienen "respuesta de selección".
  answers:     Record<number, AnswerBucket[]>;
  motivoBreakdown: MotivoBreakdownRow[];
  alerts:      FunnelAlert[];
  telemetryStartsAt: string;
};

// Día en que se activó funnel_progress + quiz simplificado.
export const TELEMETRY_STARTS_AT = "2026-05-26";

// Mapeo position (1..4) → step interno en la BD (1, 2, 6, 7).
const POSITION_TO_INTERNAL_STEP: Record<number, number> = {
  1: 1,  // motivo
  2: 2,  // nivel
  3: 6,  // datos (form completado)
  4: 7,  // trial (clase agendada)
};

const POSITION_LABELS: Record<number, string> = {
  1: "Click motivo",
  2: "Elige nivel",
  3: "Completa el formulario",
  4: "Agenda clase de prueba",
};

// ── Query principal ───────────────────────────────────────────────

export async function getFunnelAdsData(days: number): Promise<FunnelAdsData> {
  const sb = supabaseAdmin();
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  // ── 1. Sesiones por paso ────────────────────────────────────────

  // Paso 1 (motivo) — fuente preferida: lead_motivo_inicial (historia
  // completa desde antes de funnel_progress). Si no hay ahí, fallback
  // a funnel_progress.step=1.
  const { data: paso1Data } = await sb
    .from("lead_motivo_inicial")
    .select("session_id")
    .gte("created_at", since);
  const sessionsStep1 = new Set(
    (paso1Data ?? []).map((r: { session_id: string }) => r.session_id),
  ).size;

  // Paso 2 (nivel) — funnel_progress step=2
  const { data: paso2Data } = await sb
    .from("funnel_progress")
    .select("session_id")
    .eq("step", 2)
    .gte("created_at", since);
  const sessionsStep2 = new Set(
    (paso2Data ?? []).map((r: { session_id: string }) => r.session_id),
  ).size;

  // Pasos 3 (datos) y 4 (trial) — usamos `leads` como ground truth.
  // Más robusto que funnel_progress porque captura leads creados antes
  // de la activación de la telemetría granular.
  const { data: leadsRows } = await sb
    .from("leads")
    .select("id, motivo_inicial, trial_scheduled_at, status")
    .gte("created_at", since)
    .eq("source", "diagnostico");

  const sessionsStep3 = (leadsRows ?? []).length;
  const sessionsStep4 = (leadsRows ?? []).filter(
    (l: { trial_scheduled_at: string | null }) => l.trial_scheduled_at !== null,
  ).length;

  const reachedByPosition: Record<number, number> = {
    1: sessionsStep1,
    2: sessionsStep2,
    3: sessionsStep3,
    4: sessionsStep4,
  };

  const steps: FunnelStepStats[] = [];
  let prevReached: number | null = null;
  for (const pos of [1, 2, 3, 4]) {
    const reached = reachedByPosition[pos];
    let drop_from_prev: number | null = null;
    if (prevReached !== null && prevReached > 0) {
      drop_from_prev = 100 * (prevReached - reached) / prevReached;
    }
    const pct_of_entry = sessionsStep1 > 0 ? 100 * reached / sessionsStep1 : 0;
    steps.push({
      position: pos,
      internal_step: POSITION_TO_INTERNAL_STEP[pos],
      label: POSITION_LABELS[pos],
      reached,
      drop_from_prev,
      pct_of_entry,
    });
    prevReached = reached;
  }

  // ── 2. Respuestas por paso (sólo posiciones 1 y 2 del quiz) ────

  const answers: Record<number, AnswerBucket[]> = {};

  // Posición 1 (motivo) — lead_motivo_inicial, historia completa.
  const { data: m1 } = await sb
    .from("lead_motivo_inicial")
    .select("motivo")
    .gte("created_at", since);
  const m1Counts: Record<string, number> = {};
  for (const r of (m1 ?? []) as Array<{ motivo: string | null }>) {
    const k = r.motivo ?? "(sin respuesta)";
    m1Counts[k] = (m1Counts[k] ?? 0) + 1;
  }
  const m1Total = Object.values(m1Counts).reduce((a, b) => a + b, 0);
  answers[1] = Object.entries(m1Counts)
    .sort((a, b) => b[1] - a[1])
    .map(([answer, count]) => ({
      position: 1,
      step_label: POSITION_LABELS[1],
      answer,
      count,
      pct: m1Total > 0 ? 100 * count / m1Total : 0,
    }));

  // Posición 2 (nivel) — funnel_progress step=2
  const { data: lvlData } = await sb
    .from("funnel_progress")
    .select("answer")
    .eq("step", 2)
    .gte("created_at", since);
  const lvlCounts: Record<string, number> = {};
  for (const r of (lvlData ?? []) as Array<{ answer: string | null }>) {
    const k = r.answer ?? "(sin respuesta)";
    lvlCounts[k] = (lvlCounts[k] ?? 0) + 1;
  }
  const lvlTotal = Object.values(lvlCounts).reduce((a, b) => a + b, 0);
  answers[2] = Object.entries(lvlCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([answer, count]) => ({
      position: 2,
      step_label: POSITION_LABELS[2],
      answer,
      count,
      pct: lvlTotal > 0 ? 100 * count / lvlTotal : 0,
    }));

  // Distribución de respuestas para datos demográficos enriquecidos —
  // qué países llegan al paso 3, qué nivel real tienen.
  // Nota: en el funnel simplificado goal/urgency/budget vienen del
  // followup de Stiv, no del quiz. Aquí mostramos los datos de los
  // leads que completaron el form (nivel + país).
  const { data: countryData } = await sb
    .from("leads")
    .select("country")
    .gte("created_at", since)
    .eq("source", "diagnostico");
  const countryCounts: Record<string, number> = {};
  for (const r of (countryData ?? []) as Array<{ country: string | null }>) {
    const k = r.country ?? "(sin país)";
    countryCounts[k] = (countryCounts[k] ?? 0) + 1;
  }
  const countryTotal = Object.values(countryCounts).reduce((a, b) => a + b, 0);
  // Guardamos en answers[3] = país de los leads que completaron datos.
  answers[3] = Object.entries(countryCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([answer, count]) => ({
      position: 3,
      step_label: "País de leads que completan",
      answer,
      count,
      pct: countryTotal > 0 ? 100 * count / countryTotal : 0,
    }));

  // ── 3. Drop-off por motivo ──────────────────────────────────────

  const motivoBreakdown = await getMotivoBreakdown(sb, since);

  // ── 4. Alertas automáticas ──────────────────────────────────────

  const alerts: FunnelAlert[] = [];

  // Drops grandes entre pasos consecutivos
  for (let i = 1; i < steps.length; i++) {
    const s = steps[i];
    if (s.drop_from_prev !== null && s.drop_from_prev >= 50 && steps[i - 1].reached >= 10) {
      alerts.push({
        severity: s.drop_from_prev >= 75 ? "high" : "medium",
        title: `${s.drop_from_prev.toFixed(0)}% abandono entre "${steps[i - 1].label}" y "${s.label}"`,
        detail: `${steps[i - 1].reached} llegaron al paso anterior, sólo ${s.reached} avanzaron a "${s.label}".`,
      });
    }
  }

  // Conversión global muy baja (paso 1 → paso 3 = formulario)
  const formularioReached = steps[2].reached; // posición 3 = formulario
  if (sessionsStep1 >= 50 && formularioReached < sessionsStep1 * 0.10) {
    alerts.push({
      severity: "high",
      title: "Conversión paso 1 → formulario muy baja",
      detail: `Sólo ${formularioReached} de ${sessionsStep1} sesiones (${(100 * formularioReached / sessionsStep1).toFixed(1)}%) completan el formulario. Objetivo: >15%.`,
    });
  }

  // Trial agendada = 0 con leads creados — bug crítico
  if (formularioReached >= 5 && steps[3].reached === 0) {
    alerts.push({
      severity: "high",
      title: "Ningún lead agenda clase de prueba",
      detail: `${formularioReached} leads completaron el formulario pero 0 agendaron trial. Posible bug en /api/public/book-trial.`,
    });
  }

  // Motivos con conversión 0% — el motivo "particulares" llegó a 0%
  // en datos históricos, marcamos los que aún tengan ese patrón.
  for (const m of motivoBreakdown) {
    if (m.sessions >= 20 && m.pct_datos < 3) {
      alerts.push({
        severity: "high",
        title: `Motivo "${m.motivo}" no convierte`,
        detail: `${m.sessions} sesiones con motivo "${m.motivo}" pero sólo ${m.reached_datos} completaron el formulario (${m.pct_datos.toFixed(1)}%).`,
      });
    }
  }

  // Países sin conversión (alerta secundaria si llega volumen)
  for (const [country, n] of Object.entries(countryCounts)) {
    if (country === "(sin país)" || country === "XX") continue;
    if (n >= 5 && n < sessionsStep1 * 0.30) {
      // (silencioso — sólo si quieres ver mix por país luego)
    }
  }

  return {
    days,
    steps,
    answers,
    motivoBreakdown,
    alerts,
    telemetryStartsAt: TELEMETRY_STARTS_AT,
  };
}

type SB = ReturnType<typeof supabaseAdmin>;

async function getMotivoBreakdown(sb: SB, since: string): Promise<MotivoBreakdownRow[]> {
  // Sesiones por motivo (paso 1)
  const { data: mot } = await sb
    .from("lead_motivo_inicial")
    .select("motivo")
    .gte("created_at", since);
  const sessions: Record<string, number> = {};
  for (const r of (mot ?? []) as Array<{ motivo: string | null }>) {
    const k = r.motivo ?? "?";
    sessions[k] = (sessions[k] ?? 0) + 1;
  }

  // Leads por motivo (paso 3 = datos) + trial scheduled (paso 4) + converted
  const { data: leads } = await sb
    .from("leads")
    .select("motivo_inicial, trial_scheduled_at, status")
    .gte("created_at", since)
    .eq("source", "diagnostico");

  const reachedDatos: Record<string, number> = {};
  const reachedTrial: Record<string, number> = {};
  const converted: Record<string, number> = {};
  for (const r of (leads ?? []) as Array<{
    motivo_inicial: string | null;
    trial_scheduled_at: string | null;
    status: string;
  }>) {
    const k = r.motivo_inicial ?? "?";
    reachedDatos[k] = (reachedDatos[k] ?? 0) + 1;
    if (r.trial_scheduled_at) reachedTrial[k] = (reachedTrial[k] ?? 0) + 1;
    if (r.status === "converted") converted[k] = (converted[k] ?? 0) + 1;
  }

  return Object.entries(sessions)
    .map(([motivo, n]) => {
      const rd = reachedDatos[motivo] ?? 0;
      const rt = reachedTrial[motivo] ?? 0;
      return {
        motivo,
        sessions:   n,
        reached_datos:  rd,
        pct_datos:      n > 0 ? 100 * rd / n : 0,
        reached_trial:  rt,
        pct_trial:      n > 0 ? 100 * rt / n : 0,
        converted:  converted[motivo] ?? 0,
      };
    })
    .sort((a, b) => b.sessions - a.sessions);
}
