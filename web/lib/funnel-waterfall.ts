import { supabaseAdmin } from "./supabase";

/**
 * Query builder para la instrumentación granular de funnel_progress
 * (steps 10-16 introducidos 2026-07-19). Devuelve el waterfall completo
 * con drop-off entre pasos + desglose por landing/dispositivo.
 *
 * Coste: 1 query agregada + 1 para el desglose por landing. Sin JOINs
 * pesados.
 */

// Códigos de step que vamos a mostrar en el waterfall (10-16 + submit ok).
// Los legacy (1-6 del quiz Diagnostico) se dejan fuera — este waterfall
// mide el nuevo flow landing → trial.
export const WATERFALL_STEPS: Array<{ code: number; key: string; label: string }> = [
  { code: 10, key: "landing_view",       label: "1. Vio la landing" },
  { code: 11, key: "cta_click",          label: "2. Click en CTA" },
  { code: 12, key: "slot_page_view",     label: "3. Llegó a /agendar" },
  { code: 13, key: "day_picked",         label: "4. Eligió día" },
  { code: 14, key: "slot_picked",        label: "5. Eligió hora" },
  { code: 3,  key: "form_opened",        label: "6. Vio el formulario" },
  { code: 4,  key: "field_typed",        label: "7. Empezó a rellenar" },
  { code: 15, key: "phone_valid",        label: "8. WhatsApp válido" },
  { code: 16, key: "commitment_checked", label: "9. Marcó compromiso" },
  { code: 5,  key: "submit_attempt",     label: "10. Intentó reservar" },
  { code: 6,  key: "submit_ok",          label: "11. Trial agendada ✓" },
];

export type WaterfallStep = {
  code:            number;
  key:             string;
  label:           string;
  sessions:        number;
  pctOfStart:      number;
  dropFromPrev:    number | null;
  dropCountFromPrev: number | null;
};

export type WaterfallData = {
  steps:      WaterfallStep[];
  totalStart: number; // sesiones únicas en step 10 (landing_view)
  windowDays: number;
};

export async function getWaterfall(opts: {
  days:           number;
  landingIntent?: string;
  device?:        "mobile" | "desktop";
}): Promise<WaterfallData> {
  const sb = supabaseAdmin();
  const sinceIso = new Date(Date.now() - opts.days * 86_400_000).toISOString();
  const stepCodes = WATERFALL_STEPS.map(s => s.code);

  // Query base: filas de funnel_progress en el rango + steps que
  // queremos. Después agrupamos en memoria porque `distinct` en
  // Postgrest necesita RPC — evitable con un for loop.
  let q = sb
    .from("funnel_progress")
    .select("step, session_id, landing_intent, user_agent")
    .gte("created_at", sinceIso)
    .in("step", stepCodes);
  if (opts.landingIntent) q = q.eq("landing_intent", opts.landingIntent);

  const { data, error } = await q;
  if (error) throw error;
  const rows = (data ?? []) as Array<{
    step: number;
    session_id: string;
    landing_intent: string | null;
    user_agent: string | null;
  }>;

  // Filter device si viene
  const isMobile = (ua: string | null) =>
    !!ua && /mobile|iphone|android|ipad/i.test(ua);
  const filtered = opts.device
    ? rows.filter(r => (opts.device === "mobile") === isMobile(r.user_agent))
    : rows;

  // Sesiones únicas por step
  const bySession: Record<number, Set<string>> = {};
  for (const r of filtered) {
    if (!bySession[r.step]) bySession[r.step] = new Set();
    bySession[r.step].add(r.session_id);
  }

  const totalStart = bySession[10]?.size ?? 0;
  const steps: WaterfallStep[] = [];
  let prevCount: number | null = null;
  for (const s of WATERFALL_STEPS) {
    const cnt = bySession[s.code]?.size ?? 0;
    const pctOfStart = totalStart > 0 ? (100 * cnt) / totalStart : 0;
    const dropFromPrev = prevCount !== null && prevCount > 0
      ? (100 * (prevCount - cnt)) / prevCount
      : null;
    const dropCountFromPrev = prevCount !== null ? prevCount - cnt : null;
    steps.push({
      code: s.code,
      key: s.key,
      label: s.label,
      sessions: cnt,
      pctOfStart,
      dropFromPrev,
      dropCountFromPrev,
    });
    prevCount = cnt;
  }

  return { steps, totalStart, windowDays: opts.days };
}

export type LandingRow = {
  landingIntent: string;
  step10:  number;
  step11:  number;
  step12:  number;
  step14:  number; // slot_picked (hitos clave: llegó a la parte importante)
  step5:   number; // submit_attempt
  step6:   number; // submit_ok
  ctrPct:  number; // %  step10 → step11
  bookPct: number; // %  step10 → step6
};

/**
 * Comparador de landings — 6 landings side by side, mismos hitos.
 * Devuelve solo las landings con >0 sesiones en el rango.
 */
export async function getLandingComparator(days: number): Promise<LandingRow[]> {
  const sb = supabaseAdmin();
  const sinceIso = new Date(Date.now() - days * 86_400_000).toISOString();
  const KEYS = [10, 11, 12, 14, 5, 6];
  const { data } = await sb
    .from("funnel_progress")
    .select("step, session_id, landing_intent")
    .gte("created_at", sinceIso)
    .in("step", KEYS)
    .not("landing_intent", "is", null);

  const rows = (data ?? []) as Array<{
    step: number;
    session_id: string;
    landing_intent: string;
  }>;

  const byLanding = new Map<string, Record<number, Set<string>>>();
  for (const r of rows) {
    const bucket = byLanding.get(r.landing_intent) ?? {};
    if (!bucket[r.step]) bucket[r.step] = new Set();
    bucket[r.step].add(r.session_id);
    byLanding.set(r.landing_intent, bucket);
  }

  const out: LandingRow[] = [];
  for (const [landing, bucket] of byLanding) {
    const step10 = bucket[10]?.size ?? 0;
    const step6  = bucket[6]?.size  ?? 0;
    const step11 = bucket[11]?.size ?? 0;
    out.push({
      landingIntent: landing,
      step10,
      step11,
      step12: bucket[12]?.size ?? 0,
      step14: bucket[14]?.size ?? 0,
      step5:  bucket[5]?.size  ?? 0,
      step6,
      ctrPct:  step10 > 0 ? (100 * step11) / step10 : 0,
      bookPct: step10 > 0 ? (100 * step6)  / step10 : 0,
    });
  }
  return out.sort((a, b) => b.step10 - a.step10);
}

/**
 * Drill-down: sesiones que llegaron a un step pero NO al siguiente.
 * Devuelve session_ids con timestamp + landing + ua para investigación.
 */
export async function getDropoffSessions(opts: {
  days:           number;
  stepFrom:       number;
  stepTo:         number;
  landingIntent?: string;
  limit?:         number;
}): Promise<Array<{
  sessionId:     string;
  reachedAt:     string;
  landingIntent: string | null;
  userAgent:     string | null;
}>> {
  const sb = supabaseAdmin();
  const sinceIso = new Date(Date.now() - opts.days * 86_400_000).toISOString();
  const limit = Math.min(500, opts.limit ?? 100);

  let q = sb
    .from("funnel_progress")
    .select("session_id, created_at, landing_intent, user_agent")
    .eq("step", opts.stepFrom)
    .gte("created_at", sinceIso);
  if (opts.landingIntent) q = q.eq("landing_intent", opts.landingIntent);
  const { data: reachedFrom } = await q;

  // Sesiones que también llegaron al stepTo
  let q2 = sb
    .from("funnel_progress")
    .select("session_id")
    .eq("step", opts.stepTo)
    .gte("created_at", sinceIso);
  if (opts.landingIntent) q2 = q2.eq("landing_intent", opts.landingIntent);
  const { data: reachedTo } = await q2;
  const reachedToSet = new Set(
    ((reachedTo ?? []) as Array<{ session_id: string }>).map(r => r.session_id),
  );

  const dropoffs = ((reachedFrom ?? []) as Array<{
    session_id:     string;
    created_at:     string;
    landing_intent: string | null;
    user_agent:     string | null;
  }>).filter(r => !reachedToSet.has(r.session_id));

  return dropoffs.slice(0, limit).map(r => ({
    sessionId:     r.session_id,
    reachedAt:     r.created_at,
    landingIntent: r.landing_intent,
    userAgent:     r.user_agent,
  }));
}
