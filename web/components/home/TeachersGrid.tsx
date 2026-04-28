/**
 * "Tus profesores" section without real photos. We use stylized
 * geometric SVG portraits + brand-colour initial blocks instead —
 * Gelfis explicitly said no photos available, and we'd rather
 * project polish than risk uncanny stock images.
 *
 * Each card has: portrait, name, role tag (Profesor humano / IA),
 * country flag, certifications, one-line teaching style.
 *
 * Hans (the AI tutor) gets a distinctive treatment so visitors
 * don't expect a human at first glance.
 */

type TeacherCard = {
  initial: string;       // letter shown on the portrait
  name:    string;
  tagline: string;       // one-line teaching style
  flag:    string;
  country: string;
  certs:   string[];
  isAi?:   boolean;
  hue:     "warm" | "navy" | "emerald" | "violet";
};

const TEACHERS: TeacherCard[] = [
  {
    initial: "A",
    name:    "Anna",
    tagline: "Te hace hablar desde el primer minuto.",
    flag:    "🇩🇪",
    country: "Berlín",
    certs:   ["DaF", "C2 nativa"],
    hue:     "warm",
  },
  {
    initial: "M",
    name:    "Markus",
    tagline: "Especialista en preparación Goethe.",
    flag:    "🇩🇪",
    country: "Múnich",
    certs:   ["Goethe-Lehrwerkstatt", "DaF"],
    hue:     "navy",
  },
  {
    initial: "S",
    name:    "Sabine",
    tagline: "Gramática sin trauma, español de apoyo.",
    flag:    "🇨🇭",
    country: "Zúrich",
    certs:   ["DaF", "Filóloga"],
    hue:     "emerald",
  },
  {
    initial: "H",
    name:    "Hans",
    tagline: "Tu tutor IA disponible 24/7 en SCHULE.",
    flag:    "🤖",
    country: "Online",
    certs:   ["Asistente IA", "Práctica ilimitada"],
    isAi:    true,
    hue:     "violet",
  },
];

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
  return (
    <section id="profesores" className="hidden md:block bg-white dark:bg-slate-950">
      <div className="mx-auto max-w-7xl px-6 lg:px-10 py-20">
        <div className="text-center max-w-2xl mx-auto">
          <span className="text-[11px] font-bold uppercase tracking-[0.22em] text-warm">
            Tu profesor
          </span>
          <h2 className="mt-3 text-3xl lg:text-[40px] font-bold tracking-tight text-foreground leading-tight">
            Profesores nativos que <span className="text-warm">hablan tu idioma.</span>
          </h2>
          <p className="mt-4 text-base lg:text-lg text-muted-foreground leading-relaxed">
            Todos viven en Alemania, Austria o Suiza, están certificados, y
            cambian al español cuando te trabas — solo lo justo para
            desbloquearte y volver al alemán.
          </p>
        </div>

        <div className="mt-14 grid grid-cols-2 lg:grid-cols-4 gap-5 lg:gap-6">
          {TEACHERS.map((t) => (
            <article
              key={t.name}
              className="group relative rounded-3xl border border-border bg-card
                         p-5 lg:p-6 hover:shadow-xl hover:-translate-y-0.5
                         transition-all"
            >
              {/* Portrait: gradient block with the initial */}
              <div className={`relative aspect-square rounded-2xl
                               bg-gradient-to-br ${HUE_BG[t.hue]} ring-1
                               flex items-center justify-center overflow-hidden`}>
                <span className={`text-7xl font-black ${HUE_TEXT[t.hue]} drop-shadow-sm`}>
                  {t.initial}
                </span>
                {/* Decorative dots — geometric, on-brand, no stock photo */}
                <span aria-hidden className="absolute top-3 right-3 h-2 w-2 rounded-full bg-warm/60" />
                <span aria-hidden className="absolute bottom-3 left-3 h-1.5 w-1.5 rounded-full bg-warm/40" />
                <span aria-hidden className="absolute bottom-6 left-6 h-1 w-1 rounded-full bg-warm/30" />

                {t.isAi && (
                  <span className="absolute top-3 left-3 inline-flex items-center gap-1
                                   rounded-full bg-violet-500/95 text-white
                                   text-[10px] font-bold uppercase tracking-wider
                                   px-2 py-0.5">
                    🤖 IA
                  </span>
                )}
              </div>

              <div className="mt-4">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="text-lg font-bold text-foreground">{t.name}</h3>
                  <span className="text-sm" aria-label={t.country}>{t.flag}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{t.country}</p>
                <p className="mt-3 text-sm text-foreground/80 leading-relaxed">
                  {t.tagline}
                </p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {t.certs.map(c => (
                    <span key={c} className="inline-flex items-center rounded-full
                                              bg-muted px-2 py-0.5 text-[10.5px]
                                              font-medium text-muted-foreground">
                      {c}
                    </span>
                  ))}
                </div>
              </div>
            </article>
          ))}
        </div>

        <p className="mt-10 text-center text-xs text-muted-foreground">
          La asignación final se hace según tu nivel y disponibilidad.
        </p>
      </div>
    </section>
  );
}
