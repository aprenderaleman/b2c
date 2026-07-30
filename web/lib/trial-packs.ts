/**
 * Catálogo de packs / planes que el profesor ofrece al lead tras la
 * clase de prueba.
 *
 * Dos categorías:
 *   1. Suscripciones mensuales (ritmo) — pago recurrente mensual.
 *   2. Pagos únicos por meta — un solo pago, objetivo concreto.
 *
 * Cada entrada tiene un solo enlace de Stripe (url).
 * El profe elige el plan en el modal "Enviar enlace" y el sistema le
 * manda al lead el enlace correspondiente por WhatsApp / email.
 */

export type PackId =
  | "estandar"
  | "intensivo"
  | "vip_express"
  | "a1_a2"
  | "b1"
  | "b2"
  | "c1"
  | "fluidez_total"
  | "kids";

export type PaymentType = "single" | "flexible" | "extended";

export type PackCategory = "monthly" | "goal" | "other";

export type Pack = {
  id:           PackId;
  name:         string;
  category:     PackCategory;
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
  // ── Suscripciones mensuales ────────────────────────────────────────
  {
    id:    "estandar",
    name:  "⭐ Estándar (8 clases/mes) — 320 €/mes",
    category: "monthly",
    classes: 8,
    priceCents: 32_000,
    bestFor: ["personal_growth", "travel"],
    urlSingle:   "https://buy.stripe.com/bJeeV6e1D4Dqc8fd9t0co0v",
    urlFlexible: "https://buy.stripe.com/bJeeV6e1D4Dqc8fd9t0co0v",
    labels: {
      single:   "320 €/mes",
      flexible: "320 €/mes",
    },
  },
  {
    id:    "intensivo",
    name:  "🚀 Intensivo (12 clases/mes) — 450 €/mes",
    category: "monthly",
    classes: 12,
    priceCents: 45_000,
    bestFor: ["work", "studies"],
    urlSingle:   "https://buy.stripe.com/6oUcMY9Ln5Hu2xFb1l0co0w",
    urlFlexible: "https://buy.stripe.com/6oUcMY9Ln5Hu2xFb1l0co0w",
    labels: {
      single:   "450 €/mes",
      flexible: "450 €/mes",
    },
  },
  {
    id:    "vip_express",
    name:  "👑 VIP Express (16 clases/mes) — 690 €/mes",
    category: "monthly",
    classes: 16,
    priceCents: 69_000,
    bestFor: ["work", "already_in_dach", "exam"],
    urlSingle:   "https://buy.stripe.com/bJe6oA8Hj5Hu4FN2uP0co0x",
    urlFlexible: "https://buy.stripe.com/bJe6oA8Hj5Hu4FN2uP0co0x",
    labels: {
      single:   "690 €/mes",
      flexible: "690 €/mes",
    },
  },
  // ── Pagos únicos por meta ──────────────────────────────────────────
  {
    id:    "a1_a2",
    name:  "A1-A2 Arranque Alemania — 1.180 €",
    category: "goal",
    classes: 0,
    priceCents: 118_000,
    bestFor: ["personal_growth", "travel"],
    urlSingle:   "https://buy.stripe.com/aFa00caPrb1Odcj1qL0co0y",
    urlFlexible: "https://buy.stripe.com/aFa00caPrb1Odcj1qL0co0y",
    labels: {
      single:   "Pago único (1.180 €)",
      flexible: "Pago único (1.180 €)",
    },
  },
  {
    id:    "b1",
    name:  "B1 Tu B1 Garantizado — 1.720 €",
    category: "goal",
    classes: 0,
    priceCents: 172_000,
    bestFor: ["studies", "work"],
    urlSingle:   "https://buy.stripe.com/00w28kf5H7PCa078Td0co0z",
    urlFlexible: "https://buy.stripe.com/00w28kf5H7PCa078Td0co0z",
    labels: {
      single:   "Pago único (1.720 €)",
      flexible: "Pago único (1.720 €)",
    },
  },
  {
    id:    "b2",
    name:  "B2 Nivel Avanzado — 1.720 €",
    category: "goal",
    classes: 0,
    priceCents: 172_000,
    bestFor: ["work", "exam"],
    urlSingle:   "https://buy.stripe.com/28EdR2g9L5Hua075H10co0A",
    urlFlexible: "https://buy.stripe.com/28EdR2g9L5Hua075H10co0A",
    labels: {
      single:   "Pago único (1.720 €)",
      flexible: "Pago único (1.720 €)",
    },
  },
  {
    id:    "c1",
    name:  "C1 Nivel Profesional — 2.100 €",
    category: "goal",
    classes: 0,
    priceCents: 210_000,
    bestFor: ["work", "already_in_dach"],
    urlSingle:   "https://buy.stripe.com/6oU8wI6zb8TG4FN6L50co0B",
    urlFlexible: "https://buy.stripe.com/6oU8wI6zb8TG4FN6L50co0B",
    labels: {
      single:   "Pago único (2.100 €)",
      flexible: "Pago único (2.100 €)",
    },
  },
  {
    id:    "fluidez_total",
    name:  "Fluidez Total (A0→B1) — 2.990 €",
    category: "goal",
    classes: 0,
    priceCents: 299_000,
    bestFor: ["work", "already_in_dach", "studies"],
    urlSingle:   "https://buy.stripe.com/dRmcMYe1Dd9W8W35H10co0r",
    urlFlexible: "https://buy.stripe.com/dRmcMYe1Dd9W8W35H10co0r",
    labels: {
      single:   "Pago único (2.990 €)",
      flexible: "Pago único (2.990 €)",
    },
  },
  // ── Otros ──────────────────────────────────────────────────────────
  {
    id:    "kids",
    name:  "Pack Kids — 890 €",
    category: "other",
    classes: 24,
    priceCents: 89_000,
    bestFor: ["personal_growth"],
    urlSingle:   "https://buy.stripe.com/4gMeV68Hj5Hu8W3d9t0co0o",
    urlFlexible: "https://buy.stripe.com/3cIaEQ1eR5Hu7RZ5H10co0q",
    labels: {
      single:   "Pago único (890 €)",
      flexible: "Paga durante tu formación (305 € × 3)",
    },
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
