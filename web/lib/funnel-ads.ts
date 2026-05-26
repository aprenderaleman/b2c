/**
 * Queries para /admin/ads — dashboard de optimización del funnel de
 * diagnóstico.
 *
 * Combina dos fuentes:
 *   1. funnel_progress (telemetría granular por paso, una fila por
 *      (session_id, step). Sólo tiene datos desde 2026-05-26.
 *   2. leads + lead_motivo_inicial (datos pre-existentes, sirven como
 *      "ground truth" del paso 1 y paso 6+).
 *
 * El dashboard usa funnel_progress para todo lo nuevo y leads para
 * verificar/complementar. Cuando funnel_progress aún no tenga
 * suficientes datos (ventana <7 días) marcamos los buckets como
 * "datos en cuarentena".
 */

import { supabaseAdmin } from "./supabase";

// ── Tipos ─────────────────────────────────────────────────────────

export type FunnelStepStats = {
  step:          number;          // 1..7
  label:         string;
  reached:       number;          // sesiones que llegaron a este paso
  drop_from_prev: number | null;  // % que cayeron vs paso anterior
  pct_of_entry: number;           // % del paso 1 (entrada) que llegaron aquí
};

export type AnswerBucket = {
  step:    number;
  step_label: string;
  answer:  string;
  count:   number;
  pct:     number;
};

export type FunnelAlert = {
  severity: "high" | "medium" | "low";
  title:    string;
  detail:   string;
};

export type FunnelAdsData = {
  days:        number;
  steps:       FunnelStepStats[];
  answers:     Record<number, AnswerBucket[]>;  // por step
  motivoBreakdown: Array<{
    motivo:     string;
    sessions:   number;
    reached_5:  number;
    pct_5:      number;
    reached_6:  number;
    pct_6:      number;
    reached_7:  number;
    pct_7:      number;
    converted:  number;
  }>;
  alerts:      FunnelAlert[];
  // Cuándo se aplicó la telemetría granular — buckets de pasos 2-5
  // sólo son confiables desde esta fecha. Antes mostramos "?".
  telemetryStartsAt: string;
};

// 2026-05-26: día en que se activó funnel_progress. Antes, los pasos
// 2-4 no se persistían. Usado para mostrar/ocultar buckets antiguos.
export const TELEMETRY_STARTS_AT = "2026-05-26";

const STEP_LABELS: Record<number, string> = {
  1: "Click motivo",
  2: "Elige nivel",
  3: "Elige objetivo",
  4: "Elige urgencia",
  5: "Elige presupuesto",
  6: "Captura datos",
  7: "Agendó clase de prueba",
};

// ── Query principal ───────────────────────────────────────────────

export async function getFunnelAdsData(days: number): Promise<FunnelAdsData> {
  const sb = supabaseAdmin();
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  // ── 1. Pasos 1-7: conteo de sesiones que llegaron a cada paso.
  //
  // Estrategia: para cada paso, contamos session_ids distintos en
  // funnel_progress con step >= N. Si no hay datos para ese paso aún
  // (antes de TELEMETRY_STARTS_AT), caemos a `leads` como proxy.

  // Paso 1: tenemos dos fuentes — lead_motivo_inicial (vieja) y
  // funnel_progress step=1 (nueva). Usamos lead_motivo_inicial porque
  // tiene historia completa.
  const { data: paso1Data } = await sb
    .from("lead_motivo_inicial")
    .select("session_id", { count: "exact", head: false })
    .gte("created_at", since);
  const sessionsStep1 = new Set((paso1Data ?? []).map((r: { session_id: string }) => r.session_id)).size;

  // Pasos 2-5: directo de funnel_progress.
  const reachedByStep: Record<number, number> = { 1: sessionsStep1 };
  for (const step of [2, 3, 4, 5]) {
    const { data } = await sb
      .from("funnel_progress")
      .select("session_id")
      .eq("step", step)
      .gte("created_at", since);
    reachedByStep[step] = new Set((data ?? []).map((r: { session_id: string }) => r.session_id)).size;
  }

  // Paso 6 (datos enviados): unión de funnel_progress.step=6 y leads
  // que vinieron del funnel. Usamos leads como ground truth.
  const { data: lead6 } = await sb
    .from("leads")
    .select("id, motivo_inicial, trial_scheduled_at, status")
    .gte("created_at", since)
    .eq("source", "diagnostico");
  reachedByStep[6] = (lead6 ?? []).length;

  // Paso 7 (trial agendada): leads con trial_scheduled_at.
  reachedByStep[7] = (lead6 ?? []).filter(
    (l: { trial_scheduled_at: string | null }) => l.trial_scheduled_at !== null,
  ).length;

  const steps: FunnelStepStats[] = [];
  let prevReached: number | null = null;
  for (const stepNum of [1, 2, 3, 4, 5, 6, 7]) {
    const reached = reachedByStep[stepNum];
    let drop_from_prev: number | null = null;
    if (prevReached !== null && prevReached > 0) {
      drop_from_prev = 100 * (prevReached - reached) / prevReached;
    }
    const pct_of_entry = sessionsStep1 > 0 ? 100 * reached / sessionsStep1 : 0;
    steps.push({
      step: stepNum,
      label: STEP_LABELS[stepNum],
      reached,
      drop_from_prev,
      pct_of_entry,
    });
    prevReached = reached;
  }

  // ── 2. Buckets de respuestas por paso (1-5)
  // Paso 1 viene de lead_motivo_inicial (historia completa).
  // Pasos 2-5 vienen de funnel_progress.
  const answers: Record<number, AnswerBucket[]> = {};

  // Paso 1: motivo
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
      step: 1,
      step_label: STEP_LABELS[1],
      answer,
      count,
      pct: m1Total > 0 ? 100 * count / m1Total : 0,
    }));

  // Pasos 2-5: funnel_progress.answer
  for (const step of [2, 3, 4, 5]) {
    const { data } = await sb
      .from("funnel_progress")
      .select("answer")
      .eq("step", step)
      .gte("created_at", since);
    const counts: Record<string, number> = {};
    for (const r of (data ?? []) as Array<{ answer: string | null }>) {
      const k = r.answer ?? "(sin respuesta)";
      counts[k] = (counts[k] ?? 0) + 1;
    }
    const tot = Object.values(counts).reduce((a, b) => a + b, 0);
    answers[step] = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([answer, count]) => ({
        step,
        step_label: STEP_LABELS[step],
        answer,
        count,
        pct: tot > 0 ? 100 * count / tot : 0,
      }));
  }

  // ── 3. Drop-off por motivo
  const motivoBreakdown = await getMotivoBreakdown(sb, since);

  // ── 4. Alertas — fugas detectadas
  const alerts: FunnelAlert[] = [];
  for (let i = 1; i < steps.length; i++) {
    const s = steps[i];
    if (s.drop_from_prev !== null && s.drop_from_prev >= 60 && steps[i - 1].reached >= 10) {
      alerts.push({
        severity: s.drop_from_prev >= 80 ? "high" : "medium",
        title: `${s.drop_from_prev.toFixed(0)}% abandono entre paso ${i} y paso ${i + 1}`,
        detail: `${steps[i - 1].reached} llegaron a "${steps[i - 1].label}" pero sólo ${s.reached} pasaron a "${s.label}".`,
      });
    }
  }
  // Conversión global muy baja
  if (sessionsStep1 >= 50 && steps[5].reached < sessionsStep1 * 0.10) {
    alerts.push({
      severity: "high",
      title: "Conversión global paso 1 → paso 6 muy baja",
      detail: `Sólo ${steps[5].reached} de ${sessionsStep1} llegan a captura de datos (${(100 * steps[5].reached / sessionsStep1).toFixed(1)}%). Objetivo: >15%.`,
    });
  }
  // Motivos con 0% conversión
  for (const m of motivoBreakdown) {
    if (m.sessions >= 20 && m.pct_5 < 3) {
      alerts.push({
        severity: "high",
        title: `Motivo "${m.motivo}" no convierte`,
        detail: `${m.sessions} sesiones con motivo "${m.motivo}" pero sólo ${m.reached_5} llegaron a paso 5 (${m.pct_5.toFixed(1)}%).`,
      });
    }
  }
  // Trial scheduled = 0 con leads creados
  if (steps[5].reached >= 10 && steps[6].reached === 0) {
    alerts.push({
      severity: "high",
      title: "Ningún lead agenda clase de prueba",
      detail: `${steps[5].reached} leads completaron datos pero 0 agendaron trial. Posible bug en paso 7 del funnel.`,
    });
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

async function getMotivoBreakdown(sb: SB, since: string) {
  // sesiones por motivo
  const { data: mot } = await sb
    .from("lead_motivo_inicial")
    .select("motivo")
    .gte("created_at", since);
  const sessions: Record<string, number> = {};
  for (const r of (mot ?? []) as Array<{ motivo: string | null }>) {
    const k = r.motivo ?? "?";
    sessions[k] = (sessions[k] ?? 0) + 1;
  }

  // leads por motivo + trial scheduled + converted
  const { data: leads } = await sb
    .from("leads")
    .select("motivo_inicial, trial_scheduled_at, status")
    .gte("created_at", since)
    .eq("source", "diagnostico");

  const reached5: Record<string, number> = {};
  const reached6: Record<string, number> = {};
  const reached7: Record<string, number> = {};  // estimación: trial agendada
  const converted: Record<string, number> = {};
  for (const r of (leads ?? []) as Array<{
    motivo_inicial: string | null;
    trial_scheduled_at: string | null;
    status: string;
  }>) {
    const k = r.motivo_inicial ?? "?";
    reached5[k] = (reached5[k] ?? 0) + 1;
    reached6[k] = (reached6[k] ?? 0) + 1;
    if (r.trial_scheduled_at) reached7[k] = (reached7[k] ?? 0) + 1;
    if (r.status === "converted") converted[k] = (converted[k] ?? 0) + 1;
  }

  return Object.entries(sessions)
    .map(([motivo, n]) => {
      const r5 = reached5[motivo] ?? 0;
      const r6 = reached6[motivo] ?? 0;
      const r7 = reached7[motivo] ?? 0;
      return {
        motivo,
        sessions:   n,
        reached_5:  r5,
        pct_5:      n > 0 ? 100 * r5 / n : 0,
        reached_6:  r6,
        pct_6:      n > 0 ? 100 * r6 / n : 0,
        reached_7:  r7,
        pct_7:      n > 0 ? 100 * r7 / n : 0,
        converted:  converted[motivo] ?? 0,
      };
    })
    .sort((a, b) => b.sessions - a.sessions);
}
