/**
 * Catálogo de planes que el profesor ofrece al lead tras la clase de
 * prueba.
 *
 * Dos modalidades:
 *   1. Suscripciones mensuales — 3 ritmos × 5 metas = 15 combos.
 *      URL = ritmo.baseUrl + ?client_reference_id=<goal.refId>
 *   2. Pagos únicos por meta — 5 opciones con URL directa.
 *   3. Kids — pack especial con pago único / flexible.
 */

// ── Ritmos (suscripciones mensuales) ─────────────────────────────────

export type RitmoId = "viajero" | "estandar" | "intensivo" | "vip_express";
export type GoalId  = "a1_a2" | "b1" | "b2" | "c1" | "fluidez_total";

export type GoalDetail = {
  id:          GoalId;
  label:       string;
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

export const RITMOS: Ritmo[] = [
  {
    id: "viajero",
    name: "Viajero",
    emoji: "🌍",
    pricePerMonth: 240,
    classesPerMonth: 6,
    baseUrl: "https://buy.stripe.com/cNi7sE8Hjd9Wfkr2uP0co0D",
    goals: [
      { id: "a1_a2",         label: "A1-A2",         months: 6,  totalCents: 144_000, refId: "goal_a1a2" },
      { id: "b1",            label: "B1",            months: 8,  totalCents: 192_000, refId: "goal_b1" },
      { id: "b2",            label: "B2",            months: 8,  totalCents: 192_000, refId: "goal_b2" },
      { id: "c1",            label: "C1",            months: 10, totalCents: 240_000, refId: "goal_c1" },
      { id: "fluidez_total", label: "Fluidez Total", months: 16, totalCents: 384_000, refId: "goal_zero_to_b1" },
    ],
  },
  {
    id: "estandar",
    name: "Estándar",
    emoji: "⭐",
    pricePerMonth: 320,
    classesPerMonth: 8,
    baseUrl: "https://buy.stripe.com/bJeeV6e1D4Dqc8fd9t0co0v",
    goals: [
      { id: "a1_a2",         label: "A1-A2",         months: 4,  totalCents: 128_000, refId: "goal_a1a2" },
      { id: "b1",            label: "B1",            months: 6,  totalCents: 192_000, refId: "goal_b1" },
      { id: "b2",            label: "B2",            months: 6,  totalCents: 192_000, refId: "goal_b2" },
      { id: "c1",            label: "C1",            months: 8,  totalCents: 256_000, refId: "goal_c1" },
      { id: "fluidez_total", label: "Fluidez Total", months: 12, totalCents: 384_000, refId: "goal_zero_to_b1" },
    ],
  },
  {
    id: "intensivo",
    name: "Intensivo",
    emoji: "🚀",
    pricePerMonth: 450,
    classesPerMonth: 12,
    baseUrl: "https://buy.stripe.com/6oUcMY9Ln5Hu2xFb1l0co0w",
    goals: [
      { id: "a1_a2",         label: "A1-A2",         months: 3, totalCents: 135_000, refId: "goal_a1a2" },
      { id: "b1",            label: "B1",            months: 4, totalCents: 180_000, refId: "goal_b1" },
      { id: "b2",            label: "B2",            months: 4, totalCents: 180_000, refId: "goal_b2" },
      { id: "c1",            label: "C1",            months: 5, totalCents: 225_000, refId: "goal_c1" },
      { id: "fluidez_total", label: "Fluidez Total", months: 8, totalCents: 360_000, refId: "goal_zero_to_b1" },
    ],
  },
  {
    id: "vip_express",
    name: "VIP Express",
    emoji: "👑",
    pricePerMonth: 690,
    classesPerMonth: 16,
    baseUrl: "https://buy.stripe.com/bJe6oA8Hj5Hu4FN2uP0co0x",
    goals: [
      { id: "a1_a2",         label: "A1-A2",         months: 2, totalCents: 138_000, refId: "goal_a1a2" },
      { id: "b1",            label: "B1",            months: 3, totalCents: 207_000, refId: "goal_b1" },
      { id: "b2",            label: "B2",            months: 3, totalCents: 207_000, refId: "goal_b2" },
      { id: "c1",            label: "C1",            months: 4, totalCents: 276_000, refId: "goal_c1" },
      { id: "fluidez_total", label: "Fluidez Total", months: 6, totalCents: 414_000, refId: "goal_zero_to_b1" },
    ],
  },
];

// ── Pagos únicos por meta ────────────────────────────────────────────

export type OneTimePack = {
  id:         GoalId;
  name:       string;
  priceCents: number;
  url:        string;
};

export const ONE_TIME_PACKS: OneTimePack[] = [
  { id: "a1_a2",         name: "A1-A2 Arranque Alemania",  priceCents: 118_000, url: "https://buy.stripe.com/aFa00caPrb1Odcj1qL0co0y" },
  { id: "b1",            name: "B1 Tu B1 Garantizado",     priceCents: 172_000, url: "https://buy.stripe.com/00w28kf5H7PCa078Td0co0z" },
  { id: "b2",            name: "B2 Nivel Avanzado",        priceCents: 172_000, url: "https://buy.stripe.com/28EdR2g9L5Hua075H10co0A" },
  { id: "c1",            name: "C1 Nivel Profesional",     priceCents: 210_000, url: "https://buy.stripe.com/6oU8wI6zb8TG4FN6L50co0B" },
  { id: "fluidez_total", name: "Fluidez Total (A0→B1)",    priceCents: 299_000, url: "https://buy.stripe.com/dRmcMYe1Dd9W8W35H10co0r" },
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
    classes:    0,
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
