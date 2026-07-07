/**
 * Catálogo de packs que Gelfis ofrece al lead tras la clase de prueba.
 *
 * Cada pack tiene 2-3 enlaces de Stripe:
 *   - urlSingle    → pago único
 *   - urlFlexible  → pago durante tu formación (mensualidades cortas)
 *   - urlExtended  → financiación extendida (más cuotas, solo VIP e Inmersión)
 *
 * El profe elige el pack + tipo de pago en el modal "Enviar enlace" y
 * el sistema le manda al lead el enlace correspondiente por WhatsApp.
 */

export type PackId =
  | "basico"
  | "intermedio"
  | "avanzado"
  | "vip_express"
  | "inmersion_total";

export type PaymentType = "single" | "flexible" | "extended";

export type Pack = {
  id:           PackId;
  name:         string;
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
  {
    id:    "basico",
    name:  "Pack Básico",
    classes: 32,
    priceCents: 128_000,
    bestFor: ["personal_growth", "travel"],
    urlSingle:   "https://buy.stripe.com/aFa8wIg9L0naa076L50co0b",
    urlFlexible: "https://buy.stripe.com/4gM9AMg9L0na3BJ4CX0co0c",
    labels: {
      single:   "Pago único (1.280 €)",
      flexible: "Paga durante tu formación (460 € × 3)",
    },
  },
  {
    id:    "intermedio",
    name:  "Pack Intermedio",
    classes: 48,
    priceCents: 192_000,
    bestFor: ["studies", "work"],
    urlSingle:   "https://buy.stripe.com/00w6oA8Hj8TG5JR8Td0co0d",
    urlFlexible: "https://buy.stripe.com/14AdR27Df3zmegn9Xh0co0e",
    labels: {
      single:   "Pago único (1.920 €)",
      flexible: "Paga durante tu formación (530 € × 4)",
    },
  },
  {
    id:    "avanzado",
    name:  "Pack Avanzado",
    classes: 60,
    priceCents: 240_000,
    bestFor: ["work", "exam"],
    urlSingle:   "https://buy.stripe.com/dRmaEQ2iV3zmb4b6L50co0f",
    urlFlexible: "https://buy.stripe.com/4gM8wIcXzc5S2xFd9t0co0g",
    labels: {
      single:   "Pago único (2.400 €)",
      flexible: "Paga durante tu formación (540 € × 5)",
    },
  },
  {
    id:    "vip_express",
    name:  "Pack VIP Express",
    classes: 72,
    priceCents: 269_000,
    bestFor: ["work", "already_in_dach", "exam"],
    urlSingle:   "https://buy.stripe.com/9B65kwg9Lfi4a07fhB0co0h",
    urlFlexible: "https://buy.stripe.com/00w7sE9Ln4Dqgovc5p0co0i",
    urlExtended: "https://buy.stripe.com/cNidR26zb2viegnedx0co0l",
    labels: {
      single:   "Pago único (2.690 €)",
      flexible: "Paga durante tu formación (500 € × 6)",
      extended: "Financiación extendida (320 € × 10)",
    },
  },
  {
    id:    "inmersion_total",
    name:  "Pack Inmersión Total",
    classes: 100,
    priceCents: 329_000,
    bestFor: ["work", "already_in_dach", "studies"],
    urlSingle:   "https://buy.stripe.com/3cI28kf5H8TG6NVfhB0co0j",
    urlFlexible: "https://buy.stripe.com/3cI9AMaPr6Lydcjd9t0co0k",
    urlExtended: "https://buy.stripe.com/dRm00ccXz5Hugov6L50co0m",
    labels: {
      single:   "Pago único (3.290 €)",
      flexible: "Paga durante tu formación (455 € × 8)",
      extended: "Financiación extendida (330 € × 12)",
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

/**
 * Recomienda 2 packs para presentar al lead en el wizard /cp,
 * basado en sus respuestas a los filtros del Paso 4:
 *
 *   - horarios "changing" → siempre 2 packs INDIVIDUALES (grupales
 *     requieren compromiso de horario fijo).
 *   - horarios "fixed" + 1 nivel → Pack Inicio + VIP Express
 *     (grupal económico vs individual rápido).
 *   - horarios "fixed" + confianza al hablar → Pack Fluidez Total +
 *     VIP Individuales (grupal completo vs individual premium).
 *
 * Decisión Gelfis 2026-06-08: siempre 2 packs para que el lead "elija"
 * y se sienta dueño de la decisión (mejor cierre que 1 sola opción).
 */
export type ScheduleType = "fixed" | "changing";
export type LearningGoal = "one_level" | "confidence";

export function recommendPacks(
  schedule: ScheduleType,
  goal:     LearningGoal,
): [PackId, PackId] {
  if (schedule === "changing") {
    return ["avanzado", "vip_express"];
  }
  // fixed schedule
  if (goal === "one_level") {
    return ["basico", "intermedio"];
  }
  return ["avanzado", "vip_express"];
}

/** Override por env var (PACK_URL_<PACKID>_<SINGLE|FLEXIBLE>) — sin redeploy. */
export function getPackUrlWithOverride(packId: PackId, payment: PaymentType): string {
  const envKey = `PACK_URL_${packId.toUpperCase()}_${payment.toUpperCase()}`;
  const fromEnv = process.env[envKey];
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  const pack = getPack(packId);
  return pack ? packUrl(pack, payment) : "";
}
