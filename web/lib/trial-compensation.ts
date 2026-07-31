/**
 * Compensación a profesores por clases de prueba.
 *
 * Política Gelfis 2026-06-23:
 *   BASE: 0€ — las clases de prueba forman parte del rol del profesor.
 *
 *   COMISIÓN por conversión (al pulsar "Convertir en estudiante"):
 *     Pack Básico        → 75€ pago único /  30€ primera cuota
 *     Pack Intermedio     → 100€ / 40€
 *     Pack Avanzado       → 150€ / 50€
 *     Pack VIP Express    → 200€ / 60€
 *     Pack Inmersión Total→ 250€ / 75€
 *
 *   BONO por desempeño mensual (calculado al cierre de mes):
 *     <30% close rate  → 0€
 *     30-39%           → +50€ por venta del mes
 *     ≥40%             → +100€ por venta del mes
 *
 * La comisión se guarda en `class_hours_log` ligada a la trial class
 * — el rollup mensual de `teacher_earnings` la suma automáticamente.
 *
 * IDs de pack vienen de `lib/trial-packs.ts`.
 */
import { supabaseAdmin } from "./supabase";

export const PACK_COMMISSION_SINGLE_CENTS: Record<string, number> = {
  viajero:         5_000,    //  50€
  estandar:        7_500,    //  75€
  intensivo:      10_000,    // 100€
  vip_express:    15_000,    // 150€
  a1_a2:           7_500,    //  75€
  b1:             10_000,    // 100€
  b2:             10_000,    // 100€
  c1:             15_000,    // 150€
  fluidez_total:  25_000,    // 250€
  kids:            5_000,    //  50€
};

export const PACK_COMMISSION_FLEXIBLE_CENTS: Record<string, number> = {
  viajero:         5_000,    //  50€
  estandar:        7_500,    //  75€
  intensivo:      10_000,    // 100€
  vip_express:    15_000,    // 150€
  a1_a2:           7_500,    //  75€
  b1:             10_000,    // 100€
  b2:             10_000,    // 100€
  c1:             15_000,    // 150€
  fluidez_total:  25_000,    // 250€
  kids:            2_000,    //  20€
};

/** Backwards-compatible lookup — uses single by default. */
export const PACK_COMMISSION_CENTS: Record<string, number> = PACK_COMMISSION_SINGLE_CENTS;

export function getCommissionCents(packId: string, paymentType: "single" | "flexible" | "extended"): number {
  const map = (paymentType === "flexible" || paymentType === "extended") ? PACK_COMMISSION_FLEXIBLE_CENTS : PACK_COMMISSION_SINGLE_CENTS;
  return map[packId] ?? 0;
}

/** Performance bonus tiers based on monthly close rate. */
export const PERFORMANCE_BONUS_TIERS = [
  { minRate: 40, bonusCentsPerSale: 10_000 },  // ≥40% → +100€
  { minRate: 30, bonusCentsPerSale:  5_000 },  // 30-39% → +50€
] as const;

export function getPerformanceBonusCentsPerSale(closeRatePercent: number): number {
  for (const tier of PERFORMANCE_BONUS_TIERS) {
    if (closeRatePercent >= tier.minRate) return tier.bonusCentsPerSale;
  }
  return 0;
}

/**
 * Inserta la comisión por conversión. Devuelve cents pagados, 0 si el
 * pack no tiene comisión definida, o null si ya estaba pagada.
 *
 * La comisión se asocia a la trial class (mismo class_id que el base)
 * para que aparezca en la factura mensual del profe junto con el resto.
 */
export async function payConversionCommission(args: {
  trialClassId: string;
  teacherId:    string;
  packId:       string;
  paymentType?: "single" | "flexible" | "extended";
}): Promise<number | null> {
  const amount = getCommissionCents(args.packId, args.paymentType ?? "single");
  if (!amount) {
    console.warn(`[trial-compensation] No commission for pack ${args.packId}`);
    return 0;
  }

  const sb = supabaseAdmin();
  const { error } = await sb
    .from("class_hours_log")
    .upsert({
      class_id:         args.trialClassId,
      teacher_id:       args.teacherId,
      duration_minutes: 0,
      rate_at_time:     0,
      amount_cents:     amount,
      currency:         "EUR",
      kind:             "commission",
    }, { onConflict: "class_id,kind" });
  if (error) {
    console.error("[trial-compensation] payCommission failed:", error.message);
    return null;
  }
  return amount;
}

/**
 * Registra (o actualiza) el bono de desempeño para una conversión.
 * Se recalcula el close rate del mes actual del profe y se inserta/
 * actualiza la fila de bono en class_hours_log con kind='bonus'.
 */
export async function payPerformanceBonus(args: {
  trialClassId: string;
  teacherId:    string;
}): Promise<number | null> {
  const rate = await getTeacherCloseRate(args.teacherId, new Date());
  const bonusCents = rate.bonusCentsPerSale;
  if (bonusCents === 0) return 0;

  const sb = supabaseAdmin();
  const { error } = await sb
    .from("class_hours_log")
    .upsert({
      class_id:         args.trialClassId,
      teacher_id:       args.teacherId,
      duration_minutes: 0,
      rate_at_time:     0,
      amount_cents:     bonusCents,
      currency:         "EUR",
      kind:             "bonus",
    }, { onConflict: "class_id,kind" });
  if (error) {
    console.error("[trial-compensation] payBonus failed:", error.message);
    return null;
  }
  return bonusCents;
}

/**
 * Devuelve el teacher_id de la trial class más reciente del lead
 * (completada/programada) o null si no hay trial vinculado.
 */
export async function getLeadTrialTeacher(leadId: string): Promise<{
  classId:   string;
  teacherId: string;
} | null> {
  const sb = supabaseAdmin();
  const { data } = await sb
    .from("classes")
    .select("id, teacher_id, status, scheduled_at")
    .eq("lead_id", leadId)
    .eq("is_trial", true)
    .in("status", ["completed", "scheduled", "live"])
    .order("scheduled_at", { ascending: false })
    .limit(1);
  const r = (data ?? [])[0] as { id: string; teacher_id: string } | undefined;
  if (!r) return null;
  return { classId: r.id, teacherId: r.teacher_id };
}

// =============================================================================
// Close rate per teacher — used for performance bonus calculation
// =============================================================================

export type TeacherCloseRate = {
  teacherId:      string;
  trialsAttended: number;
  conversions:    number;
  closeRate:      number;   // 0-100
  bonusCentsPerSale: number;
  totalBonusCents:   number;
};

/**
 * Calcula la tasa de cierre de un profesor en un mes dado.
 * close rate = (leads convertidos cuya trial fue con este profe) / (trials atendidas por este profe)
 */
export async function getTeacherCloseRate(
  teacherId: string,
  monthDate: Date,
): Promise<TeacherCloseRate> {
  const sb = supabaseAdmin();
  const monthStart = new Date(Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth(), 1));
  const monthEnd   = new Date(Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth() + 1, 1));

  // Trials atendidas por este profe en el mes
  const { data: trialClasses } = await sb
    .from("classes")
    .select("id, lead_id")
    .eq("teacher_id", teacherId)
    .eq("is_trial", true)
    .in("status", ["completed", "scheduled", "live"])
    .gte("scheduled_at", monthStart.toISOString())
    .lt("scheduled_at", monthEnd.toISOString());

  const trials = (trialClasses ?? []) as Array<{ id: string; lead_id: string | null }>;
  const trialLeadIds = trials.map(t => t.lead_id).filter((id): id is string => !!id);
  const trialsAttended = trialLeadIds.length;

  if (trialsAttended === 0) {
    return { teacherId, trialsAttended: 0, conversions: 0, closeRate: 0, bonusCentsPerSale: 0, totalBonusCents: 0 };
  }

  // De esos leads, cuántos convirtieron
  const { data: convertedLeads } = await sb
    .from("leads")
    .select("id")
    .in("id", trialLeadIds)
    .not("converted_at", "is", null);

  const conversions = (convertedLeads ?? []).length;
  const closeRate = (conversions / trialsAttended) * 100;
  const bonusCentsPerSale = getPerformanceBonusCentsPerSale(closeRate);
  const totalBonusCents = bonusCentsPerSale * conversions;

  return { teacherId, trialsAttended, conversions, closeRate, bonusCentsPerSale, totalBonusCents };
}

/**
 * Calcula close rates de todos los profesores activos para un mes.
 */
export async function getAllTeacherCloseRates(monthDate: Date): Promise<TeacherCloseRate[]> {
  const sb = supabaseAdmin();
  const monthStart = new Date(Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth(), 1));
  const monthEnd   = new Date(Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth() + 1, 1));

  const { data: trialClasses } = await sb
    .from("classes")
    .select("teacher_id, lead_id")
    .eq("is_trial", true)
    .in("status", ["completed", "scheduled", "live"])
    .gte("scheduled_at", monthStart.toISOString())
    .lt("scheduled_at", monthEnd.toISOString());

  const trials = (trialClasses ?? []) as Array<{ teacher_id: string; lead_id: string | null }>;
  if (trials.length === 0) return [];

  const byTeacher = new Map<string, string[]>();
  for (const t of trials) {
    if (!t.lead_id) continue;
    const list = byTeacher.get(t.teacher_id) ?? [];
    list.push(t.lead_id);
    byTeacher.set(t.teacher_id, list);
  }

  const allLeadIds = [...new Set(trials.map(t => t.lead_id).filter((id): id is string => !!id))];
  const { data: convertedLeads } = await sb
    .from("leads")
    .select("id")
    .in("id", allLeadIds)
    .not("converted_at", "is", null);

  const convertedSet = new Set((convertedLeads ?? []).map((l: { id: string }) => l.id));

  const results: TeacherCloseRate[] = [];
  for (const [teacherId, leadIds] of byTeacher) {
    const trialsAttended = leadIds.length;
    const conversions = leadIds.filter(id => convertedSet.has(id)).length;
    const closeRate = (conversions / trialsAttended) * 100;
    const bonusCentsPerSale = getPerformanceBonusCentsPerSale(closeRate);
    results.push({
      teacherId, trialsAttended, conversions, closeRate, bonusCentsPerSale,
      totalBonusCents: bonusCentsPerSale * conversions,
    });
  }
  return results;
}
