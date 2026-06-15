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

/**
 * Asistencia a la clase de prueba: de los leads que AGENDARON un trial
 * en la ventana, cuántos terminaron asistiendo, no asistiendo o quedaron
 * pendientes de marcar.
 *
 * Fuente: lead_timeline.status_change con texto "Lead attended trial" /
 * "Lead did not attend trial" — los emite markTrialAttendedAwaitingConversion
 * y markTrialAbsent en lib/admin-actions.ts.
 */
export type TrialAttendance = {
  scheduled: number;   // total trials agendados en la ventana
  attended:  number;   // de esos, cuántos asistieron
  absent:    number;   // de esos, cuántos no asistieron
  pending:   number;   // de esos, cuántos no se han marcado todavía (clase aún por venir o sin marcar)
  /** Tasa de asistencia REAL = attended / (attended + absent). Excluye
   * los pending del denominador — solo considera trials ya resueltos.
   * null si no hay trials resueltos en la ventana. */
  attendance_rate: number | null;
};

export type FunnelAdsData = {
  days:        number;
  steps:       FunnelStepStats[];
  // Sólo hay respuestas medibles en los pasos del quiz (posiciones 1 y 2).
  // Los pasos 3 (datos) y 4 (trial) no tienen "respuesta de selección".
  answers:     Record<number, AnswerBucket[]>;
  motivoBreakdown: MotivoBreakdownRow[];
  // Desglose por landing dedicada (Google Ads, post-058). Separado
  // del motivo porque la landing es 'de dónde llega' y el motivo es
  // 'qué dice que quiere'.
  landingBreakdown: LandingBreakdownRow[];
  // Conteo bruto de leads con status='converted' cuya conversión cae
  // en la ventana de días. Cuenta TODOS — incluso los que no tienen
  // motivo_inicial (creados manualmente o por canales no-funnel).
  // El sumar motivoBreakdown.converted se queda corto porque excluye
  // leads con motivo NULL. (Caso Alejandra 2026-06-02.)
  totalConverted: number;
  trialAttendance: TrialAttendance;
  alerts:      FunnelAlert[];
  telemetryStartsAt: string;
  microFunnel: MicroFunnelData;
};

/**
 * Micro-embudo dentro del paso 3 (form). Datos desde 2026-06-01
 * (cuando se desplegó la telemetría granular).
 *
 * Pipeline interno:
 *   step=2 (nivel elegido) → step=3 (form abierto) → step=4 (escribió
 *   algo) → step=5 (intento de envío con outcome) → step=6 (lead OK).
 *
 * outcomes es el desglose de `funnel_progress.answer` cuando step=5.
 * Permite ver POR QUÉ se rechaza un submit (validación cliente,
 * server, rate limit, etc).
 */
export type MicroFunnelData = {
  /** Sesiones únicas que llegaron a cada sub-paso. */
  reached_step2:           number; // eligen nivel
  reached_form_opened:     number; // step=3 / "form_opened"
  reached_field_typed:     number; // step=4 / "field_typed"
  reached_submit_attempt:  number; // step=5 (cualquier outcome)
  reached_submit_ok:       number; // step=6 / lead creado
  /** Desglose de outcomes del intento de envío. Sólo cuenta el
   *  ÚLTIMO outcome por sesión (un lead puede intentar varias veces). */
  outcomes:                Array<{ outcome: string; count: number; pct: number }>;
  /** Fecha desde la que tenemos micro-datos (los rangos previos a esto
   *  mostrarán 0 en los sub-pasos 3, 4, 5). */
  microStartsAt:           string;
};

// Día en que se desplegó la telemetría granular del paso 3 (commit eede774).
export const MICRO_TELEMETRY_STARTS_AT = "2026-06-01";

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

/**
 * Lista de países que aparecen en los leads del funnel (para poblar
 * el dropdown del filtro). Devuelve [{code,count}] ordenado por volumen.
 * El country se infiere del prefijo del WhatsApp en /register.
 */
export async function getAvailableCountries(days: number): Promise<Array<{ code: string; count: number }>> {
  const sb = supabaseAdmin();
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data } = await sb
    .from("leads")
    .select("country")
    .gte("created_at", since)
    .not("motivo_inicial", "is", null);
  const counts: Record<string, number> = {};
  for (const r of (data ?? []) as Array<{ country: string | null }>) {
    const k = (r.country ?? "XX").toUpperCase();
    counts[k] = (counts[k] ?? 0) + 1;
  }
  return Object.entries(counts)
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count);
}

export async function getFunnelAdsData(
  days: number,
  countryFilter?: string,
): Promise<FunnelAdsData> {
  const sb = supabaseAdmin();
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  // Normalizamos el filtro a ISO-2 mayúsculas; vacío/falsy = sin filtro.
  const country = countryFilter && countryFilter.trim().length === 2
    ? countryFilter.trim().toUpperCase()
    : null;

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
  //
  // Nota crítica: book-trial cambia el source del lead de 'diagnostico'
  // a 'funnel_trial_self_book' al agendar la clase. Por eso NO filtramos
  // por source aquí; en su lugar usamos `motivo_inicial IS NOT NULL`
  // (lo setea sólo el funnel) como discriminador. Sin esto la métrica
  // de trials daba 0 falsamente.
  let leadsQ = sb
    .from("leads")
    .select("id, motivo_inicial, trial_scheduled_at, trial_attended_at, trial_absent_at, status, source, country")
    .gte("created_at", since)
    .or("motivo_inicial.not.is.null,source.eq.diagnostico,source.eq.funnel_trial_self_book");
  if (country) leadsQ = leadsQ.eq("country", country);
  const { data: leadsRows } = await leadsQ;

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
  // Países de los leads que completaron el form. Misma lógica del
  // paso 3: NO filtramos por source (cambia tras book-trial), filtramos
  // por leads del funnel (motivo_inicial NOT NULL o source funnel).
  let countryQ = sb
    .from("leads")
    .select("country")
    .gte("created_at", since)
    .or("motivo_inicial.not.is.null,source.eq.diagnostico,source.eq.funnel_trial_self_book");
  if (country) countryQ = countryQ.eq("country", country);
  const { data: countryData } = await countryQ;
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

  const motivoBreakdown = await getMotivoBreakdown(sb, since, country);

  // Total de conversiones REAL — no excluye leads sin motivo_inicial.
  // Usa converted_at si está presente; si no, cae a created_at (filas
  // viejas previas a la columna converted_at quedan con NULL).
  let convQ = sb
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("status", "converted")
    .or(`converted_at.gte.${since},and(converted_at.is.null,created_at.gte.${since})`);
  if (country) convQ = convQ.eq("country", country);
  const { count: totalConverted } = await convQ;

  // ── 3b. Asistencia a clases de prueba ──────────────────────────
  //
  // Fuente de verdad: columnas `leads.trial_attended_at` y
  // `leads.trial_absent_at` (migration 063). Antes el dashboard usaba
  // substring matching contra lead_timeline, lo que era frágil ante
  // cambios de copy y forzaba un JOIN extra. Ahora basta con leer
  // las columnas que ya trae leadsRows.
  //
  // De los leads que agendaron trial en la ventana:
  //   - attended = trial_attended_at IS NOT NULL
  //   - absent   = trial_absent_at IS NOT NULL
  //   - pending  = ni una ni la otra (clase futura o sin marcar aún)
  type LeadRow = {
    id: string;
    trial_scheduled_at: string | null;
    trial_attended_at:  string | null;
    trial_absent_at:    string | null;
  };
  const trialLeads = (leadsRows ?? []).filter(
    (l: LeadRow) => l.trial_scheduled_at !== null,
  );
  const attendedCount = trialLeads.filter((l: LeadRow) => l.trial_attended_at !== null).length;
  const absentCount   = trialLeads.filter(
    (l: LeadRow) => l.trial_absent_at !== null && l.trial_attended_at === null,
  ).length;
  const resolved = attendedCount + absentCount;
  const trialAttendance: TrialAttendance = {
    scheduled: trialLeads.length,
    attended:  attendedCount,
    absent:    absentCount,
    pending:   Math.max(0, trialLeads.length - attendedCount - absentCount),
    attendance_rate: resolved > 0 ? attendedCount / resolved : null,
  };

  // ── 4. Micro-embudo del paso 3 (form) ──────────────────────────
  const microFunnel = await getMicroFunnel(sb, since, sessionsStep2);

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

  // Desglose por landing — añadido tras 058 (landing_intent). Cada landing
  // dedicada de Google Ads queda etiquetada a nivel de sesión y de lead,
  // así que podemos ver qué intención convierte mejor (independiente del
  // motivo que el usuario eligió en el quiz).
  const landingBreakdown = await getLandingBreakdown(sb, since, country);

  return {
    days,
    steps,
    answers,
    motivoBreakdown,
    landingBreakdown,
    totalConverted: totalConverted ?? 0,
    trialAttendance,
    alerts,
    telemetryStartsAt: TELEMETRY_STARTS_AT,
    microFunnel,
  };
}

export type LandingBreakdownRow = {
  landing:        string;     // 'home','curso-online','particulares','intensivo','certificado','b2-trabajar','ciudades','(sin landing)'
  sessions:       number;     // sesiones únicas vistas en funnel_progress
  form_completed: number;     // leads con landing_intent = landing
  trial_booked:   number;     // de esos, cuántos agendaron trial
  converted:      number;     // y cuántos convirtieron (pagaron)
  pct_form:       number;     // form_completed / sessions
  pct_trial:      number;     // trial_booked / sessions
};

async function getLandingBreakdown(
  sb: SB,
  since: string,
  country: string | null,
): Promise<LandingBreakdownRow[]> {
  // Sesiones por landing — funnel_progress lleva la landing_intent
  // desde commit Fase 1.
  const { data: fp } = await sb
    .from("funnel_progress")
    .select("session_id, landing_intent")
    .gte("created_at", since);
  const sessionsByLanding: Record<string, Set<string>> = {};
  for (const r of (fp ?? []) as Array<{ session_id: string; landing_intent: string | null }>) {
    const k = r.landing_intent ?? "(sin landing)";
    if (!sessionsByLanding[k]) sessionsByLanding[k] = new Set();
    sessionsByLanding[k].add(r.session_id);
  }

  // Leads por landing
  let leadsQ = sb
    .from("leads")
    .select("landing_intent, trial_scheduled_at, status")
    .gte("created_at", since);
  if (country) leadsQ = leadsQ.eq("country", country);
  const { data: leads } = await leadsQ;

  const formByLanding:  Record<string, number> = {};
  const trialByLanding: Record<string, number> = {};
  const convByLanding:  Record<string, number> = {};
  for (const r of (leads ?? []) as Array<{
    landing_intent: string | null;
    trial_scheduled_at: string | null;
    status: string;
  }>) {
    const k = r.landing_intent ?? "(sin landing)";
    formByLanding[k] = (formByLanding[k] ?? 0) + 1;
    if (r.trial_scheduled_at) trialByLanding[k] = (trialByLanding[k] ?? 0) + 1;
    if (r.status === "converted") convByLanding[k] = (convByLanding[k] ?? 0) + 1;
  }

  // Union de claves: una landing puede tener sesiones sin lead (abandono
  // antes del form), o leads sin sesión registrada (cliente cacheado pre-058).
  const allKeys = new Set<string>([
    ...Object.keys(sessionsByLanding),
    ...Object.keys(formByLanding),
  ]);

  return Array.from(allKeys)
    .map(landing => {
      const sessions = sessionsByLanding[landing]?.size ?? 0;
      const form     = formByLanding[landing]     ?? 0;
      const trial    = trialByLanding[landing]    ?? 0;
      const conv     = convByLanding[landing]     ?? 0;
      return {
        landing,
        sessions,
        form_completed: form,
        trial_booked:   trial,
        converted:      conv,
        pct_form:       sessions > 0 ? 100 * form / sessions : 0,
        pct_trial:      sessions > 0 ? 100 * trial / sessions : 0,
      };
    })
    .sort((a, b) => b.sessions - a.sessions);
}

// ── Micro-embudo paso 3 (form) ────────────────────────────────────

async function getMicroFunnel(
  sb: SB,
  since: string,
  step2Count: number,
): Promise<MicroFunnelData> {
  // Sesiones únicas que llegaron a cada sub-paso (3, 4, 5, 6).
  // funnel_progress es idempotente por (session_id, step), así que
  // count(*) = count(DISTINCT session_id) en estas queries.
  const fetchCount = async (step: number): Promise<number> => {
    const { data } = await sb
      .from("funnel_progress")
      .select("session_id")
      .eq("step", step)
      .gte("created_at", since);
    return new Set((data ?? []).map((r: { session_id: string }) => r.session_id)).size;
  };

  const [reachedForm, reachedTyped, reachedSubmit, reachedOk] = await Promise.all([
    fetchCount(3),
    fetchCount(4),
    fetchCount(5),
    fetchCount(6),
  ]);

  // Outcomes del step=5: cada sesión puede haber intentado varias veces
  // (e.g. corrigió el email tras un client_invalid_email). Tomamos el
  // ÚLTIMO outcome por sesión — refleja por qué dejó de intentar.
  const { data: step5Rows } = await sb
    .from("funnel_progress")
    .select("session_id, answer, created_at")
    .eq("step", 5)
    .gte("created_at", since)
    .order("created_at", { ascending: false });
  const lastBySession: Record<string, string> = {};
  for (const r of (step5Rows ?? []) as Array<{ session_id: string; answer: string | null }>) {
    if (!lastBySession[r.session_id]) {
      lastBySession[r.session_id] = r.answer ?? "(sin etiqueta)";
    }
  }
  const counts: Record<string, number> = {};
  for (const a of Object.values(lastBySession)) {
    counts[a] = (counts[a] ?? 0) + 1;
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const outcomes = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([outcome, count]) => ({
      outcome,
      count,
      pct: total > 0 ? 100 * count / total : 0,
    }));

  return {
    reached_step2:          step2Count,
    reached_form_opened:    reachedForm,
    reached_field_typed:    reachedTyped,
    reached_submit_attempt: reachedSubmit,
    reached_submit_ok:      reachedOk,
    outcomes,
    microStartsAt: MICRO_TELEMETRY_STARTS_AT,
  };
}

type SB = ReturnType<typeof supabaseAdmin>;

async function getMotivoBreakdown(
  sb: SB,
  since: string,
  country: string | null,
): Promise<MotivoBreakdownRow[]> {
  // Sesiones por motivo (paso 1) — sin filtro de país porque las
  // sesiones de paso 1 no tienen país aún (sólo lo conocemos cuando
  // el lead llega al paso 3 y deja su WhatsApp).
  const { data: mot } = await sb
    .from("lead_motivo_inicial")
    .select("motivo")
    .gte("created_at", since);
  const sessions: Record<string, number> = {};
  for (const r of (mot ?? []) as Array<{ motivo: string | null }>) {
    const k = r.motivo ?? "?";
    sessions[k] = (sessions[k] ?? 0) + 1;
  }

  // Leads por motivo (paso 3+) — filtramos por país cuando aplique.
  let leadsQ = sb
    .from("leads")
    .select("motivo_inicial, trial_scheduled_at, status")
    .gte("created_at", since)
    .not("motivo_inicial", "is", null);
  if (country) leadsQ = leadsQ.eq("country", country);
  const { data: leads } = await leadsQ;

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
