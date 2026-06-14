/**
 * Compensación a profesores por clases de prueba.
 *
 * Política Gelfis 2026-06-12:
 *   BASE: 15€ por trial DADA (admin marca "✓ Asistió"). 0€ si "No asistió".
 *
 *   COMISIÓN por conversión (al pulsar "Convertir en estudiante"):
 *     Pack Inicio       →  50€
 *     Pack Fluidez      → 100€
 *     VIP Individual    →  80€
 *     VIP Express       → 200€
 *
 * Ambas se guardan como filas en `class_hours_log` ligadas a la trial
 * class — el rollup mensual de `teacher_earnings` ya las suma sin
 * tocar nada más.
 *
 * IDs de pack vienen de `lib/trial-packs.ts`.
 */
import { supabaseAdmin } from "./supabase";

export const TRIAL_BASE_CENTS = 1500;  // 15€

export const PACK_COMMISSION_CENTS: Record<string, number> = {
  "pack-inicio":      5_000,    //  50€
  "pack-fluidez":    10_000,    // 100€
  "vip-individual":   8_000,    //  80€
  "vip-express":     20_000,    // 200€
};

/**
 * Inserta la fila de BASE (15€) en class_hours_log para el profe que
 * dió la trial. Idempotente: si ya existe una fila de tipo trial_base
 * para esa clase, no inserta otra. Devuelve el amount_cents insertado
 * o null si ya estaba.
 */
export async function payTrialBase(args: {
  classId:   string;
  teacherId: string;
}): Promise<number | null> {
  const sb = supabaseAdmin();
  // Evitar duplicado: clase debe tener exactamente UNA fila de base
  const { data: existing } = await sb
    .from("class_hours_log")
    .select("id")
    .eq("class_id", args.classId)
    .limit(1);
  if ((existing ?? []).length > 0) return null;

  const { error } = await sb
    .from("class_hours_log")
    .insert({
      class_id:         args.classId,
      teacher_id:       args.teacherId,
      duration_minutes: 50,
      rate_at_time:     15,
      amount_cents:     TRIAL_BASE_CENTS,
      currency:         "EUR",
    });
  if (error) {
    console.error("[trial-compensation] payTrialBase failed:", error.message);
    return null;
  }
  return TRIAL_BASE_CENTS;
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
}): Promise<number | null> {
  const amount = PACK_COMMISSION_CENTS[args.packId];
  if (!amount) {
    console.warn(`[trial-compensation] No commission for pack ${args.packId}`);
    return 0;
  }

  const sb = supabaseAdmin();
  // Marcamos la fila como comisión con una rate_at_time muy distintiva
  // (0) y duration_minutes=0 — así un humano leyendo la tabla la
  // distingue del base. Idempotencia: una sola fila por (class_id,
  // amount_cents) con duration=0.
  const { data: existing } = await sb
    .from("class_hours_log")
    .select("id")
    .eq("class_id", args.trialClassId)
    .eq("duration_minutes", 0)
    .limit(1);
  if ((existing ?? []).length > 0) return null;

  const { error } = await sb
    .from("class_hours_log")
    .insert({
      class_id:         args.trialClassId,
      teacher_id:       args.teacherId,
      duration_minutes: 0,
      rate_at_time:     0,
      amount_cents:     amount,
      currency:         "EUR",
    });
  if (error) {
    console.error("[trial-compensation] payCommission failed:", error.message);
    return null;
  }
  return amount;
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
