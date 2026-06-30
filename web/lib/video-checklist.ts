export type VideoChecklistItem = {
  key: string;
  title: string;
  gammaUrl: string;
};

export const VIDEO_CHECKLIST_ITEMS: VideoChecklistItem[] = [
  {
    key: "2026-07_a1_leccion1",
    title: "A1 – Lección 1: Pronombres y verbos regulares",
    gammaUrl: "https://gamma.app/docs/Aleman-A1-Leccion-1-Pronombres-y-verbos-regulares-kpi01s0uhvbgt9e",
  },
  {
    key: "2026-07_a1_leccion2",
    title: "A1 – Lección 2: Artículos y género",
    gammaUrl: "",
  },
  {
    key: "2026-07_a1_leccion3",
    title: "A1 – Lección 3: Números y presentarse",
    gammaUrl: "",
  },
  {
    key: "2026-07_a1_leccion4",
    title: "A1 – Lección 4: Preguntas básicas (W-Fragen)",
    gammaUrl: "",
  },
  {
    key: "2026-07_a1_leccion5",
    title: "A1 – Lección 5: Verbos separables",
    gammaUrl: "",
  },
  {
    key: "2026-07_a1_leccion6",
    title: "A1 – Lección 6: Acusativo y artículos",
    gammaUrl: "",
  },
  {
    key: "2026-07_a1_leccion7",
    title: "A1 – Lección 7: Vocabulario de la vida diaria",
    gammaUrl: "",
  },
  {
    key: "2026-07_a1_leccion8",
    title: "A1 – Lección 8: Pasado con haben y sein",
    gammaUrl: "",
  },
];

export const VALID_KEYS = new Set(VIDEO_CHECKLIST_ITEMS.map(i => i.key));
