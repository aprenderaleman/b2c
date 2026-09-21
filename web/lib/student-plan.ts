/**
 * Resolución única del plan de un estudiante en el momento de convertir.
 *
 * Todos los caminos de conversión (webhook Stripe, conversión externa,
 * modal admin, "pago confirmado" del profe/closer, aprobación de venta,
 * alta manual) pasan por aquí para que el alumno nazca con datos reales:
 * nivel de curso (A1–C1), meta del catálogo, ritmo, contrato de clases,
 * clases/mes y precio — nunca "A0", 96 clases ni un ritmo sin precio.
 */
import {
  GOAL_CLASSES,
  RITMOS,
  KIDS_PACK,
  type GoalId,
  type RitmoId,
} from "./trial-packs";

export type CourseLevel = "A1" | "A2" | "B1" | "B2" | "C1";
export const COURSE_LEVELS: CourseLevel[] = ["A1", "A2", "B1", "B2", "C1"];

/**
 * Cualquier nivel que venga del lead ("A0", "A1.1", "A1-A2", "B2+",
 * "unsure", null…) → nivel de curso. Los alumnos empiezan en A1.
 */
export function normalizeStudentLevel(raw: string | null | undefined): CourseLevel {
  const v = (raw ?? "").trim().toUpperCase();
  if (v.startsWith("C"))  return "C1";
  if (v.startsWith("B2")) return "B2";
  if (v.startsWith("B1")) return "B1";
  if (v.startsWith("A2")) return "A2";
  return "A1";
}

const GOAL_ALIASES: Record<string, GoalId> = {
  a1a2: "a1_a2", a1_a2: "a1_a2", a2: "a1_a2", goal_a1a2: "a1_a2",
  b1: "b1", goal_b1: "b1",
  b2: "b2", goal_b2: "b2",
  c1: "c1", goal_c1: "c1",
  fluidez_total: "fluidez_total", fluidez: "fluidez_total",
  zero_to_b1: "fluidez_total", goal_zero_to_b1: "fluidez_total",
};

export function normalizeGoalId(raw: string | null | undefined): GoalId | null {
  if (!raw) return null;
  return GOAL_ALIASES[raw.trim().toLowerCase()] ?? null;
}

export function isRitmoId(v: string | null | undefined): v is RitmoId {
  return !!v && RITMOS.some(r => r.id === v);
}

export type ResolvePlanInput = {
  packId?:            string | null;   // ritmo id, goal id o "kids"
  goalId?:            string | null;   // meta explícita (catálogo)
  goal?:              string | null;   // meta libre (lead.goal) — solo si es alias del catálogo
  subscriptionType?:  string | null;
  classesPerMonth?:   number | null;
  monthlyPriceEuros?: number | null;
  clasesTotales?:     number | null;   // contrato explícito (oferta / webhook)
  classesRemaining?:  number | null;   // legado: lo que mandaban los modales
};

export type ResolvedPlan = {
  goal:               GoalId | null;
  ritmo:              RitmoId | null;
  subscriptionType:   "monthly_subscription" | "package";
  clasesTotales:      number;
  classesPerMonth:    number | null;
  monthlyPriceCents:  number | null;
  /** Clases agendables desde el día 1: el mes en suscripción, todo en pack. */
  clasesDesbloqueadas: number;
};

export function resolveStudentPlan(i: ResolvePlanInput): ResolvedPlan {
  const ritmo: RitmoId | null =
    isRitmoId(i.packId) ? i.packId
    : RITMOS.find(r => r.classesPerMonth === i.classesPerMonth)?.id
    ?? RITMOS.find(r => i.monthlyPriceEuros != null && r.pricePerMonth === i.monthlyPriceEuros)?.id
    ?? null;
  const r = ritmo ? RITMOS.find(x => x.id === ritmo)! : null;

  const goal =
    normalizeGoalId(i.goalId)
    ?? normalizeGoalId(i.packId)
    ?? normalizeGoalId(i.goal);

  const isSubscription = !!r || i.subscriptionType === "monthly_subscription";

  const clasesTotales =
    (i.clasesTotales && i.clasesTotales > 0 ? i.clasesTotales : null)
    ?? (goal ? GOAL_CLASSES[goal] : null)
    ?? (i.packId === "kids" ? KIDS_PACK.classes : null)
    ?? (i.classesRemaining && i.classesRemaining > 0 ? i.classesRemaining : null)
    ?? GOAL_CLASSES.a1_a2;

  const classesPerMonth = r?.classesPerMonth ?? (isSubscription ? (i.classesPerMonth ?? null) : null);
  const monthlyPriceCents = r
    ? r.pricePerMonth * 100
    : (isSubscription && i.monthlyPriceEuros != null ? Math.round(i.monthlyPriceEuros * 100) : null);

  return {
    goal,
    ritmo,
    subscriptionType:    isSubscription ? "monthly_subscription" : "package",
    clasesTotales,
    classesPerMonth,
    monthlyPriceCents,
    clasesDesbloqueadas: isSubscription && classesPerMonth ? Math.min(classesPerMonth, clasesTotales) : clasesTotales,
  };
}
