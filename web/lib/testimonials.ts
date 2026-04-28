/**
 * Real student testimonials, lifted verbatim from
 * https://aprender-aleman.de/es/cursos. Used in the desktop landing
 * (and reusable by future marketing pages).
 *
 * If a testimonial is removed from the marketing site it must be
 * removed here too — single source of truth otherwise drifts.
 */
export type Testimonial = {
  name:    string;
  country: string;
  level:   string;          // CEFR level reached
  quote:   string;
};

export const TESTIMONIALS: Testimonial[] = [
  {
    name:    "Patricia Beltrán",
    country: "México",
    level:   "B1",
    quote:   "Seis meses. B1. Oferta de trabajo en Berlín firmada. Sin lag, sin pánico.",
  },
  {
    name:    "María González",
    country: "México",
    level:   "B2",
    quote:   "Estuve un año en otra academia estancada en A2. Aquí llegué al B2 en 8 meses.",
  },
  {
    name:    "Daniel Vega",
    country: "Colombia",
    level:   "B1",
    quote:   "B1 en 6 meses exactos. Mi empleador en Stuttgart lo pidió como requisito mínimo.",
  },
  {
    name:    "Lucía Fernández",
    country: "España",
    level:   "C1",
    quote:   "Pensé que necesitaría un año en Berlín antes de poder trabajar. A los 7 meses ya estaba lista.",
  },
  {
    name:    "Sofía Restrepo",
    country: "Colombia",
    level:   "B2",
    quote:   "Soy médica. Necesitaba alemán sanitario y nadie me ayudaba con ese vocabulario. Aquí sí.",
  },
  {
    name:    "Mateo Ríos",
    country: "España",
    level:   "B2",
    quote:   "Tenía una entrevista en Frankfurt en seis meses. Pasé de cero a B2 a tiempo.",
  },
  {
    name:    "Diego Martínez",
    country: "Argentina",
    level:   "B1",
    quote:   "SCHULE me ordenó el caos. Antes estudiaba sin rumbo; ahora cada día sé qué toca.",
  },
  {
    name:    "Carlos Ramírez",
    country: "España",
    level:   "C1",
    quote:   "Soy ingeniero. SCHULE me dio el vocabulario técnico que necesitaba; las clases me dieron la fluidez.",
  },
  {
    name:    "Isabel Navarro",
    country: "España",
    level:   "B1",
    quote:   "Tenía pánico a la gramática. Mi profesora cambia al español 30 segundos y vuelvo al alemán sin bloquearme.",
  },
  {
    name:    "Roberto Silva",
    country: "República Dominicana",
    level:   "C1",
    quote:   "Gelfis es dominicano y vivió el mismo camino. Eso se nota.",
  },
  {
    name:    "Andrés Felipe Gómez",
    country: "Chile",
    level:   "B2",
    quote:   "Lo paga mi empresa. Yo gano alemán, ellos ganan productividad.",
  },
  {
    name:    "Valeria Castro",
    country: "Venezuela",
    level:   "A2",
    quote:   "Trabajo turnos rotativos. Hans me salva los días que no puedo entrar a clase con un profe humano.",
  },
];

/** Country flag emoji for the testimonial card. */
export function flagFor(country: string): string {
  switch (country.toLowerCase()) {
    case "méxico":              return "🇲🇽";
    case "colombia":             return "🇨🇴";
    case "españa":               return "🇪🇸";
    case "argentina":            return "🇦🇷";
    case "perú":                 return "🇵🇪";
    case "chile":                return "🇨🇱";
    case "venezuela":            return "🇻🇪";
    case "república dominicana": return "🇩🇴";
    default: return "🌎";
  }
}
