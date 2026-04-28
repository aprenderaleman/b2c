"use client";

import { useLang } from "@/lib/lang-context";

type TeacherCard = {
  initial: string;
  name:    string;
  taglineEs: string;
  taglineDe: string;
  flag:    string;
  countryEs: string;
  countryDe: string;
  certsEs?: string[];
  certsDe?: string[];
  isAi?:   boolean;
  hue:     "warm" | "navy" | "emerald" | "violet";
};

const TEACHERS: TeacherCard[] = [
  {
    initial:   "F",
    name:      "Florian",
    taglineEs: "Te hace hablar desde el primer minuto.",
    taglineDe: "Bringt dich vom ersten Moment ans Sprechen.",
    flag:      "🇦🇹",
    countryEs: "Austria",
    countryDe: "Österreich",
    hue:       "warm",
  },
  {
    initial:   "V",
    name:      "Verónica",
    taglineEs: "Especialista en preparación Goethe.",
    taglineDe: "Spezialistin für die Goethe-Prüfungsvorbereitung.",
    flag:      "🇨🇭",
    countryEs: "Suiza",
    countryDe: "Schweiz",
    hue:       "navy",
  },
  {
    initial:   "S",
    name:      "Sabine",
    taglineEs: "Gramática sin trauma, español de apoyo.",
    taglineDe: "Grammatik ohne Stress, mit Spanisch als Stütze.",
    flag:      "🇩🇪",
    countryEs: "Alemania",
    countryDe: "Deutschland",
    hue:       "emerald",
  },
  {
    initial:   "H",
    name:      "Hans",
    taglineEs: "Tu tutor IA disponible 24/7 en SCHULE.",
    taglineDe: "Dein KI-Tutor, 24/7 verfügbar auf SCHULE.",
    flag:      "🤖",
    countryEs: "Online",
    countryDe: "Online",
    certsEs:   ["Asistente IA", "Práctica ilimitada"],
    certsDe:   ["KI-Assistent", "Unbegrenzte Praxis"],
    isAi:      true,
    hue:       "violet",
  },
];

const HEAD = {
  es: {
    eyebrow: "Tu profesor",
    titlePre: "Profesores nativos que ",
    titleAccent: "hablan tu idioma.",
    sub: "Todos viven en Alemania, Austria o Suiza, son nativos, y cambian al español cuando te trabas — solo lo justo para desbloquearte y volver al alemán.",
    footnote: "La asignación final se hace según tu nivel y disponibilidad.",
  },
  de: {
    eyebrow: "Deine Lehrkraft",
    titlePre: "Muttersprachler, die ",
    titleAccent: "deine Sprache sprechen.",
    sub: "Alle leben in Deutschland, Österreich oder der Schweiz, sind Muttersprachler und wechseln kurz ins Spanische, wenn du hängst — nur so weit, dass du wieder ins Deutsche zurückkommst.",
    footnote: "Die endgültige Zuordnung erfolgt nach deinem Niveau und der Verfügbarkeit.",
  },
} as const;

const HUE_BG: Record<TeacherCard["hue"], string> = {
  warm:    "from-warm/30 to-warm/5 ring-warm/40",
  navy:    "from-navy-900/30 to-navy-900/5 ring-navy-900/30",
  emerald: "from-emerald-500/30 to-emerald-500/5 ring-emerald-500/40",
  violet:  "from-violet-500/30 to-violet-500/5 ring-violet-500/40",
};

const HUE_TEXT: Record<TeacherCard["hue"], string> = {
  warm:    "text-warm",
  navy:    "text-navy-900 dark:text-warm",
  emerald: "text-emerald-600 dark:text-emerald-400",
  violet:  "text-violet-600 dark:text-violet-400",
};

export function TeachersGrid() {
  const { lang } = useLang();
  const isDe = lang === "de";
  const head = HEAD[isDe ? "de" : "es"];
  return (
    <section id="profesores" className="hidden md:block bg-white dark:bg-slate-950">
      <div className="mx-auto max-w-7xl px-6 lg:px-10 py-20">
        <div className="text-center max-w-2xl mx-auto">
          <span className="text-[11px] font-bold uppercase tracking-[0.22em] text-warm">
            {head.eyebrow}
          </span>
          <h2 className="mt-3 text-3xl lg:text-[40px] font-bold tracking-tight text-foreground leading-tight">
            {head.titlePre}<span className="text-warm">{head.titleAccent}</span>
          </h2>
          <p className="mt-4 text-base lg:text-lg text-muted-foreground leading-relaxed">
            {head.sub}
          </p>
        </div>

        <div className="mt-14 grid grid-cols-2 lg:grid-cols-4 gap-5 lg:gap-6">
          {TEACHERS.map((t) => {
            const tagline = isDe ? t.taglineDe : t.taglineEs;
            const country = isDe ? t.countryDe : t.countryEs;
            const certs   = isDe ? t.certsDe : t.certsEs;
            return (
              <article
                key={t.name}
                className="group relative rounded-3xl border border-border bg-card
                           p-5 lg:p-6 hover:shadow-xl hover:-translate-y-0.5
                           transition-all"
              >
                <div className={`relative aspect-square rounded-2xl
                                 bg-gradient-to-br ${HUE_BG[t.hue]} ring-1
                                 flex items-center justify-center overflow-hidden`}>
                  <span className={`text-7xl font-black ${HUE_TEXT[t.hue]} drop-shadow-sm`}>
                    {t.initial}
                  </span>
                  <span aria-hidden className="absolute top-3 right-3 h-2 w-2 rounded-full bg-warm/60" />
                  <span aria-hidden className="absolute bottom-3 left-3 h-1.5 w-1.5 rounded-full bg-warm/40" />
                  <span aria-hidden className="absolute bottom-6 left-6 h-1 w-1 rounded-full bg-warm/30" />

                  {t.isAi && (
                    <span className="absolute top-3 left-3 inline-flex items-center gap-1
                                     rounded-full bg-violet-500/95 text-white
                                     text-[10px] font-bold uppercase tracking-wider
                                     px-2 py-0.5">
                      🤖 {isDe ? "KI" : "IA"}
                    </span>
                  )}
                </div>

                <div className="mt-4">
                  <div className="flex items-baseline justify-between gap-2">
                    <h3 className="text-lg font-bold text-foreground">{t.name}</h3>
                    <span className="text-sm" aria-label={country}>{t.flag}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{country}</p>
                  <p className="mt-3 text-sm text-foreground/80 leading-relaxed">
                    {tagline}
                  </p>
                  {certs && certs.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {certs.map(c => (
                        <span key={c} className="inline-flex items-center rounded-full
                                                  bg-muted px-2 py-0.5 text-[10.5px]
                                                  font-medium text-muted-foreground">
                          {c}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>

        <p className="mt-10 text-center text-xs text-muted-foreground">
          {head.footnote}
        </p>
      </div>
    </section>
  );
}
