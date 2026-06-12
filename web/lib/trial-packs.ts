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
  | "vip_individual"
  | "vip_express"
  | "inicio_grupal"
  | "fluidez_total_grupal";

export type PaymentType = "single" | "flexible";

export type Pack = {
  id:           PackId;
  name:         string;          // nombre mostrado en el WA y en el dropdown
  bestFor:      string[];        // goal ids para los que es recomendado (referencia)
  urlSingle:    string;
  urlFlexible:  string;
};

export const TRIAL_PACKS: Pack[] = [
  {
    id:    "vip_individual",
    name:  "Clases VIP Individuales",
    bestFor: ["work", "exam", "personal_growth"],
    urlSingle:   "https://buy.stripe.com/6oU00k2KPctnat3g8GdnW1m",
    urlFlexible: "https://buy.stripe.com/5kQ9AU2KPdxr1Wx7CadnW1n",
  },
  {
    id:    "vip_express",
    name:  "Pack VIP Express",
    bestFor: ["work", "already_in_dach", "exam"],
    urlSingle:   "https://buy.stripe.com/fZu3cwbhl50VdFf8GednW1o",
    urlFlexible: "https://buy.stripe.com/aFafZiadh8d7at3bSqdnW1p",
  },
  {
    id:    "inicio_grupal",
    name:  "Pack Inicio (Grupal)",
    bestFor: ["personal_growth", "travel", "studies"],
    urlSingle:   "https://buy.stripe.com/fZufZi3OT2SN7gR4pYdnW1i",
    urlFlexible: "https://buy.stripe.com/4gM7sMdpt8d7cBb5u2dnW1j",
  },
  {
    id:    "fluidez_total_grupal",
    name:  "Pack Fluidez Total (Grupal)",
    bestFor: ["work", "studies", "already_in_dach"],
    urlSingle:   "https://buy.stripe.com/bJeeVeetxctn30B4pYdnW1k",
    urlFlexible: "https://buy.stripe.com/eVq3cwadh9hb9oZ6y6dnW1l",
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
    return ["vip_individual", "vip_express"];
  }
  // fixed schedule
  if (goal === "one_level") {
    return ["inicio_grupal", "vip_express"];
  }
  return ["fluidez_total_grupal", "vip_individual"];
}

/** Override por env var (PACK_URL_<PACKID>_<SINGLE|FLEXIBLE>) — sin redeploy. */
export function getPackUrlWithOverride(packId: PackId, payment: PaymentType): string {
  const envKey = `PACK_URL_${packId.toUpperCase()}_${payment.toUpperCase()}`;
  const fromEnv = process.env[envKey];
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  const pack = getPack(packId);
  return pack ? packUrl(pack, payment) : "";
}
