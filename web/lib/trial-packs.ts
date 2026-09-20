/**
 * Catálogo de planes que el profesor ofrece al lead tras la clase de
 * prueba.
 *
 * Dos modalidades:
 *   1. Suscripciones mensuales — 4 ritmos × 5 metas = 20 combos.
 *      URL = ritmo.baseUrl + ?client_reference_id=<goal.refId>
 *   2. Pagos únicos por meta — 5 opciones con URL directa.
 *   3. Kids — pack especial con pago único / flexible.
 *
 * Regla de clases (Gelfis, 2026-09-21): la meta es el nivel al que LLEGA el
 * estudiante. Cursos: A1 = 32, A2 = 32, B1 = 48, B2 = 48, C1 = 60.
 *   a1_a2         → hace el A1 y llega a A2 ........ 32 clases
 *   b1            → hace el A2 y llega a B1 ........ 32 clases
 *   b2            → hace el B1 y llega a B2 ........ 48 clases
 *   c1            → hace el B2 y llega a C1 ........ 48 clases
 *   fluidez_total → 3 niveles (A1 → B1) ............ 92 clases
 * Un plan cubre 1 o 3 niveles, nunca 2. Los meses de suscripción se derivan
 * de las clases (redondeo hacia arriba) — el número de clases manda.
 */

// ── Ritmos (suscripciones mensuales) ─────────────────────────────────

export type RitmoId = "viajero" | "estandar" | "intensivo" | "vip_express";
export type GoalId  = "a1_a2" | "b1" | "b2" | "c1" | "fluidez_total";

export const GOAL_CLASSES: Record<GoalId, number> = {
  a1_a2:         32,
  b1:            32,
  b2:            48,
  c1:            48,
  fluidez_total: 92,
};

export const GOAL_LABELS: Record<GoalId, string> = {
  a1_a2:         "A2",
  b1:            "B1",
  b2:            "B2",
  c1:            "C1",
  fluidez_total: "Fluidez Total (A1→B1)",
};

const GOAL_REF_IDS: Record<GoalId, string> = {
  a1_a2:         "goal_a1a2",
  b1:            "goal_b1",
  b2:            "goal_b2",
  c1:            "goal_c1",
  fluidez_total: "goal_zero_to_b1",
};

export type GoalDetail = {
  id:          GoalId;
  label:       string;
  classes:     number;
  months:      number;
  totalCents:  number;
  refId:       string;
};

export type Ritmo = {
  id:              RitmoId;
  name:            string;
  emoji:           string;
  pricePerMonth:   number;
  classesPerMonth: number;
  baseUrl:         string;
  goals:           GoalDetail[];
};

type RitmoBase = Omit<Ritmo, "goals">;

function withGoals(r: RitmoBase): Ritmo {
  const goals = (Object.keys(GOAL_CLASSES) as GoalId[]).map((id): GoalDetail => {
    const classes = GOAL_CLASSES[id];
    const months  = Math.ceil(classes / r.classesPerMonth);
    return {
      id,
      label:      GOAL_LABELS[id],
      classes,
      months,
      totalCents: months * r.pricePerMonth * 100,
      refId:      GOAL_REF_IDS[id],
    };
  });
  return { ...r, goals };
}

export const RITMOS: Ritmo[] = [
  withGoals({
    id: "viajero",
    name: "Viajero",
    emoji: "🌍",
    pricePerMonth: 240,
    classesPerMonth: 6,
    baseUrl: "https://buy.stripe.com/cNi7sE8Hjd9Wfkr2uP0co0D",
  }),
  withGoals({
    id: "estandar",
    name: "Estándar",
    emoji: "⭐",
    pricePerMonth: 320,
    classesPerMonth: 8,
    baseUrl: "https://buy.stripe.com/bJeeV6e1D4Dqc8fd9t0co0v",
  }),
  withGoals({
    id: "intensivo",
    name: "Intensivo",
    emoji: "🚀",
    pricePerMonth: 450,
    classesPerMonth: 12,
    baseUrl: "https://buy.stripe.com/6oUcMY9Ln5Hu2xFb1l0co0w",
  }),
  withGoals({
    id: "vip_express",
    name: "VIP Express",
    emoji: "👑",
    pricePerMonth: 690,
    classesPerMonth: 16,
    baseUrl: "https://buy.stripe.com/bJe6oA8Hj5Hu4FN2uP0co0x",
  }),
];

// ── Pagos únicos por meta ────────────────────────────────────────────

export type OneTimePack = {
  id:         GoalId;
  name:       string;
  classes:    number;
  priceCents: number;
  url:        string;
};

export const ONE_TIME_PACKS: OneTimePack[] = [
  { id: "a1_a2",         name: "A2 Arranque Alemania",     classes: GOAL_CLASSES.a1_a2,         priceCents: 118_000, url: "https://buy.stripe.com/aFa00caPrb1Odcj1qL0co0y" },
  { id: "b1",            name: "B1 Tu B1 Garantizado",     classes: GOAL_CLASSES.b1,            priceCents: 172_000, url: "https://buy.stripe.com/00w28kf5H7PCa078Td0co0z" },
  { id: "b2",            name: "B2 Nivel Avanzado",        classes: GOAL_CLASSES.b2,            priceCents: 172_000, url: "https://buy.stripe.com/28EdR2g9L5Hua075H10co0A" },
  { id: "c1",            name: "C1 Nivel Profesional",     classes: GOAL_CLASSES.c1,            priceCents: 210_000, url: "https://buy.stripe.com/6oU8wI6zb8TG4FN6L50co0B" },
  { id: "fluidez_total", name: "Fluidez Total (A1→B1)",    classes: GOAL_CLASSES.fluidez_total, priceCents: 299_000, url: "https://buy.stripe.com/dRmcMYe1Dd9W8W35H10co0r" },
];

// ── Kids ─────────────────────────────────────────────────────────────

export const KIDS_PACK = {
  id: "kids" as const,
  name: "Pack Kids",
  classes: 24,
  priceCents: 89_000,
  urlSingle:   "https://buy.stripe.com/4gMeV68Hj5Hu8W3d9t0co0o",
  urlFlexible: "https://buy.stripe.com/3cIaEQ1eR5Hu7RZ5H10co0q",
  labels: {
    single:   "Pago único (890 €)",
    flexible: "Paga durante tu formación (305 € × 3)",
  },
};

// ── Helpers para construir URL ────────────────────────────────────────

export function buildSubscriptionUrl(ritmo: Ritmo, goal: GoalDetail): string {
  return `${ritmo.baseUrl}?client_reference_id=${goal.refId}`;
}

// ── Backward-compat types used by attended API, compensation, etc. ──

export type PackId =
  | "viajero" | "estandar" | "intensivo" | "vip_express"
  | "a1_a2" | "b1" | "b2" | "c1" | "fluidez_total"
  | "kids";

export type PaymentType = "single" | "flexible" | "extended";

export type PlanCategory = "subscription" | "one_time" | "kids";

export type Pack = {
  id:           PackId;
  name:         string;
  category:     PlanCategory;
  classes:      number;
  priceCents:   number;
  bestFor:      string[];
  urlSingle:    string;
  urlFlexible:  string;
  urlExtended?: string;
  labels: {
    single:    string;
    flexible:  string;
    extended?: string;
  };
};

export const TRIAL_PACKS: Pack[] = [
  ...RITMOS.map((r): Pack => ({
    id:         r.id,
    name:       `${r.emoji} ${r.name} (${r.classesPerMonth} clases/mes)`,
    category:   "subscription",
    classes:    r.classesPerMonth,
    priceCents: r.pricePerMonth * 100,
    bestFor:    [],
    urlSingle:  r.baseUrl,
    urlFlexible: r.baseUrl,
    labels: { single: `${r.pricePerMonth} €/mes`, flexible: `${r.pricePerMonth} €/mes` },
  })),
  ...ONE_TIME_PACKS.map((p): Pack => ({
    id:         p.id,
    name:       p.name,
    category:   "one_time",
    classes:    p.classes,
    priceCents: p.priceCents,
    bestFor:    [],
    urlSingle:  p.url,
    urlFlexible: p.url,
    labels: { single: `Pago único (${(p.priceCents / 100).toLocaleString("es-ES")} €)`, flexible: `Pago único` },
  })),
  {
    id:         "kids",
    name:       "Pack Kids",
    category:   "kids",
    classes:    24,
    priceCents: 89_000,
    bestFor:    [],
    urlSingle:  KIDS_PACK.urlSingle,
    urlFlexible: KIDS_PACK.urlFlexible,
    labels:     KIDS_PACK.labels,
  },
];

export function getPack(id: PackId): Pack | null {
  return TRIAL_PACKS.find(p => p.id === id) ?? null;
}

export function packUrl(pack: Pack, payment: PaymentType): string {
  if (payment === "extended" && pack.urlExtended) return pack.urlExtended;
  if (payment === "flexible") return pack.urlFlexible;
  return pack.urlSingle;
}

export type ScheduleType = "fixed" | "changing";
export type LearningGoal = "one_level" | "confidence";

export function recommendPacks(
  schedule: ScheduleType,
  goal:     LearningGoal,
): [PackId, PackId] {
  if (schedule === "changing") {
    return ["intensivo", "vip_express"];
  }
  if (goal === "one_level") {
    return ["estandar", "a1_a2"];
  }
  return ["intensivo", "fluidez_total"];
}

/** Override por env var (PACK_URL_<PACKID>_<SINGLE|FLEXIBLE>) — sin redeploy. */
export function getPackUrlWithOverride(packId: PackId, payment: PaymentType): string {
  const envKey = `PACK_URL_${packId.toUpperCase()}_${payment.toUpperCase()}`;
  const fromEnv = process.env[envKey];
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  const pack = getPack(packId);
  return pack ? packUrl(pack, payment) : "";
}
