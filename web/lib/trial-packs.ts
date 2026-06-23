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
    name:  "Pack Basico",
    classes: 32,
    bestFor: ["personal_growth", "travel"],
    urlSingle:   "https://buy.stripe.com/6oU00k2KPctnat3g8GdnW1m",
    urlFlexible: "https://buy.stripe.com/5kQ9AU2KPdxr1Wx7CadnW1n",
  },
  {
    id:    "intermedio",
    name:  "Pack Intermedio",
    classes: 48,
    bestFor: ["studies", "work"],
    urlSingle:   "https://buy.stripe.com/fZufZi3OT2SN7gR4pYdnW1i",
    urlFlexible: "https://buy.stripe.com/4gM7sMdpt8d7cBb5u2dnW1j",
  },
  {
    id:    "avanzado",
    name:  "Pack Avanzado",
    classes: 60,
    bestFor: ["work", "exam"],
    urlSingle:   "https://buy.stripe.com/bJeeVeetxctn30B4pYdnW1k",
    urlFlexible: "https://buy.stripe.com/eVq3cwadh9hb9oZ6y6dnW1l",
  },
  {
    id:    "vip_express",
    name:  "Pack VIP Express",
    classes: 72,
    bestFor: ["work", "already_in_dach", "exam"],
    urlSingle:   "https://buy.stripe.com/fZu3cwbhl50VdFf8GednW1o",
    urlFlexible: "https://buy.stripe.com/aFafZiadh8d7at3bSqdnW1p",
  },
  {
    id:    "inmersion_total",
    name:  "Pack Inmersion Total",
    classes: 100,
    bestFor: ["work", "already_in_dach", "studies"],
    urlSingle:   "https://buy.stripe.com/inmersion_single",
    urlFlexible: "https://buy.stripe.com/inmersion_flexible",
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
