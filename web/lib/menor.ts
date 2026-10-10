/**
 * Leads de menores (landing /clase-ninos): el lead es el padre/madre y
 * los datos del hijo/a viajan aparte. Opciones compartidas entre el
 * formulario (/agendar/cuando?tipo=menor) y book-trial.
 */

export const NIVEL_ESCOLAR = [
  "Grundschule", "Hauptschule", "Realschule", "Gymnasium", "Gesamtschule", "Berufsschule", "Otro",
] as const;

export const TIEMPO_ALEMANIA = {
  menos_1:   "Menos de 1 año",
  "1_3":     "1-3 años",
  "3_5":     "3-5 años",
  mas_5:     "Más de 5 años",
  nacido:    "Nacido/a aquí",
} as const;

export const OBJETIVO_MENOR = {
  notas:       "Mejorar notas en el colegio",
  examen:      "Prepararse para un examen",
  integracion: "Integración social",
  nivelacion:  "Nivelación tras mudanza",
  otro:        "Otro",
} as const;

export const EDADES_MENOR = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17] as const;

export type MenorDatos = {
  hijo_nombre:     string;
  hijo_edad:       number;
  nivel_escolar:   (typeof NIVEL_ESCOLAR)[number];
  tiempo_alemania: keyof typeof TIEMPO_ALEMANIA;
  objetivo:        keyof typeof OBJETIVO_MENOR;
};

/** "Lucas (9 años) — hijo/a de María": nombre que ve el profe. */
export function nombreMenorParaProfe(m: MenorDatos, padre: string): string {
  return `${m.hijo_nombre} (${m.hijo_edad} años) — hijo/a de ${padre}`;
}

/** Resumen legible para timeline / notas. */
export function resumenMenor(m: MenorDatos): string {
  return [
    `Hijo/a: ${m.hijo_nombre} (${m.hijo_edad} años)`,
    `Colegio: ${m.nivel_escolar}`,
    `En Alemania: ${TIEMPO_ALEMANIA[m.tiempo_alemania]}`,
    `Objetivo: ${OBJETIVO_MENOR[m.objetivo]}`,
  ].join(" · ");
}
