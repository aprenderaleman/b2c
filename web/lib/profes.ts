/**
 * Mapping profe slug → teacher_id + display info.
 *
 * Usado por la landing /clase-profe (campaña Meta Reels 2026-08-20) y
 * por /agendar/cuando cuando llega con ?profe=X para forzar la profe
 * concreta en el slot picker y en el book-trial.
 *
 * Añadir profes futuros: extender PROFES_MAP. Cambio de teacher_id
 * (reasignación de cuenta) → actualizar aquí; no persistimos el slug
 * en BD, solo el UUID en classes.teacher_id (fuente de verdad).
 */

export type ProfeSlug = "sabine" | "jonathan";

export type ProfeInfo = {
  slug:       ProfeSlug;
  teacherId:  string;
  firstName:  string;   // para H1 dinámico + copy
  fullName:   string;
  origin:     "DE" | "AT" | "CH";
};

export const PROFES_MAP: Record<ProfeSlug, ProfeInfo> = {
  sabine: {
    slug:      "sabine",
    teacherId: "72d93d60-a9b2-43f0-9507-36e8d26da4ed",
    firstName: "Sabine",
    fullName:  "Sabine Arning",
    origin:    "DE",
  },
  jonathan: {
    slug:      "jonathan",
    teacherId: "468968b1-4c0a-4759-af4e-4f63ac67eabf",
    firstName: "Jonathan",
    fullName:  "Jonathan Weber",
    origin:    "DE",
  },
};

/** Devuelve ProfeInfo si el slug es válido; null para forzar la variante genérica. */
export function resolveProfe(slug: string | null | undefined): ProfeInfo | null {
  if (!slug) return null;
  const norm = slug.toLowerCase().trim();
  if (norm in PROFES_MAP) return PROFES_MAP[norm as ProfeSlug];
  return null;
}

/** Construye el landing_intent que va a leads.landing_intent para reporting. */
export function landingIntentForProfe(profe: ProfeInfo | null): string {
  return profe ? `clase-profe-${profe.slug}` : "clase-profe-generico";
}
