/**
 * Catálogo de packs que Gelfis ofrece al lead tras la clase de prueba.
 *
 * Cada pack tiene DOS enlaces de Stripe:
 *   - urlSingle   → pago único
 *   - urlFlexible → pago flexible (mensualidades)
 *
 * El admin elige el pack + tipo de pago en el modal "✓ Asistió" y
 * el sistema le manda al lead el enlace correspondiente por WhatsApp.
 */

export type PackId =
  | "basico"
  | "intermedio"
  | "avanzado"
  | "vip_express"
  | "inmersion_total";

export type PaymentType = "single" | "flexible";

export type Pack = {
  id:           PackId;
  name:         string;
  classes:      number;
  bestFor:      string[];
  urlSingle:    string;
  urlFlexible:  string;
};

export const TRIAL_PACKS: Pack[] = [
  {
    id:    "basico",
    name:  "Pack Básico · 1.280 € (o 460 € × 3)",
    classes: 32,
    bestFor: ["personal_growth", "travel"],
    urlSingle:   "https://buy.stripe.com/aFa8wIg9L0naa076L50co0b",
    urlFlexible: "https://buy.stripe.com/4gM9AMg9L0na3BJ4CX0co0c",
  },
  {
    id:    "intermedio",
    name:  "Pack Intermedio · 1.920 € (o 530 € × 4)",
    classes: 48,
    bestFor: ["studies", "work"],
    urlSingle:   "https://buy.stripe.com/00w6oA8Hj8TG5JR8Td0co0d",
    urlFlexible: "https://buy.stripe.com/14AdR27Df3zmegn9Xh0co0e",
  },
  {
    id:    "avanzado",
    name:  "Pack Avanzado · 2.400 € (o 540 € × 5)",
    classes: 60,
    bestFor: ["work", "exam"],
    urlSingle:   "https://buy.stripe.com/dRmaEQ2iV3zmb4b6L50co0f",
    urlFlexible: "https://buy.stripe.com/4gM8wIcXzc5S2xFd9t0co0g",
  },
  {
    id:    "vip_express",
    name:  "Pack VIP Express · 2.690 € (o 500 € × 6)",
    classes: 72,
    bestFor: ["work", "already_in_dach", "exam"],
    urlSingle:   "https://buy.stripe.com/9B65kwg9Lfi4a07fhB0co0h",
    urlFlexible: "https://buy.stripe.com/00w7sE9Ln4Dqgovc5p0co0i",
  },
  {
    id:    "inmersion_total",
    name:  "Pack Inmersión Total · 3.290 € (o 455 € × 8)",
    classes: 100,
    bestFor: ["work", "already_in_dach", "studies"],
    urlSingle:   "https://buy.stripe.com/3cI28kf5H8TG6NVfhB0co0j",
    urlFlexible: "https://buy.stripe.com/3cI9AMaPr6Lydcjd9t0co0k",
  },
];

export function getPack(id: PackId): Pack | null {
  return TRIAL_PACKS.find(p => p.id === id) ?? null;
}

export function packUrl(pack: Pack, payment: PaymentType): string {
  return payment === "single" ? pack.urlSingle : pack.urlFlexible;
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
