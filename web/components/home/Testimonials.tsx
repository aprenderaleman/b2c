"use client";

import { useState } from "react";
import { TESTIMONIALS, flagFor, type Testimonial } from "@/lib/testimonials";
import { useLang } from "@/lib/lang-context";

const COPY = {
  es: {
    eyebrow:    "Lo que dicen nuestros alumnos",
    title:      "De cero a la fluidez en 6 meses.",
    titleAccent: "Reseñas reales.",
    seeMore:    (n: number) => `Ver ${n} reseñas más`,
    reachedLabel: "alcanzó",
    note:       null as string | null,
  },
  de: {
    eyebrow:    "Was unsere Schüler sagen",
    title:      "Von null zur Sprachsicherheit in 6 Monaten.",
    titleAccent: "Echte Bewertungen.",
    seeMore:    (n: number) => `${n} weitere Bewertungen ansehen`,
    reachedLabel: "erreichte",
    note:       "Stimmen unserer spanischsprachigen Schüler — auf Spanisch verfasst.",
  },
} as const;

/**
 * Real student testimonials — verbatim from
 * https://aprender-aleman.de/es/cursos. Six visible by default, the
 * rest revealed on click. Each card uses an avatar built from the
 * student's initials (we don't have photos, so we render a coloured
 * mark instead of fake imagery).
 */

const VISIBLE_INITIAL = 6;

// Hue rotates by index so the avatar wall doesn't read monochrome.
const HUES = ["warm", "emerald", "violet", "navy", "amber", "sky"] as const;
type Hue = typeof HUES[number];

const HUE_RING: Record<Hue, string> = {
  warm:    "bg-warm/15 text-warm",
  emerald: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  violet:  "bg-violet-500/15 text-violet-700 dark:text-violet-400",
  navy:    "bg-navy-900/15 text-navy-900 dark:text-warm",
  amber:   "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  sky:     "bg-sky-500/15 text-sky-700 dark:text-sky-400",
};

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "??";
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function Testimonials() {
  const { lang } = useLang();
  const c = COPY[lang === "de" ? "de" : "es"];
  const [showAll, setShowAll] = useState(false);
  const list = showAll ? TESTIMONIALS : TESTIMONIALS.slice(0, VISIBLE_INITIAL);

  return (
    <section id="resenas" className="hidden md:block bg-section-muted dark:bg-slate-950 border-y border-border">
      <div className="mx-auto max-w-7xl px-6 lg:px-10 py-20">
        <div className="text-center max-w-2xl mx-auto">
          <span className="text-[11px] font-bold uppercase tracking-[0.22em] text-warm">
            {c.eyebrow}
          </span>
          <h2 className="mt-3 text-3xl lg:text-[40px] font-bold tracking-tight text-foreground leading-tight">
            {c.title} <span className="text-warm">{c.titleAccent}</span>
          </h2>
          {c.note && (
            <p className="mt-3 text-xs text-muted-foreground italic">
              {c.note}
            </p>
          )}
        </div>

        <div className="mt-12 grid grid-cols-1 lg:grid-cols-3 gap-5 lg:gap-6">
          {list.map((t, i) => (
            <TestimonialCard key={t.name} t={t} hue={HUES[i % HUES.length]} reachedLabel={c.reachedLabel} />
          ))}
        </div>

        {!showAll && TESTIMONIALS.length > VISIBLE_INITIAL && (
          <div className="mt-10 text-center">
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="inline-flex items-center gap-2 rounded-full
                         border border-border bg-card hover:border-warm
                         px-5 py-2.5 text-sm font-semibold text-foreground transition-colors"
            >
              {c.seeMore(TESTIMONIALS.length - VISIBLE_INITIAL)}
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function TestimonialCard({ t, hue, reachedLabel }: { t: Testimonial; hue: Hue; reachedLabel: string }) {
  return (
    <figure className="rounded-3xl border border-border bg-card p-6 hover:shadow-lg transition-shadow flex flex-col">
      <div className="flex items-center gap-3">
        <div className={`h-12 w-12 rounded-full ${HUE_RING[hue]} flex items-center justify-center font-bold text-base shrink-0`}>
          {initialsOf(t.name)}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 font-semibold text-foreground truncate">
            <span>{t.name}</span>
            <span aria-hidden>{flagFor(t.country)}</span>
          </div>
          <div className="text-xs text-muted-foreground">
            {t.country} · {reachedLabel} <strong className="text-warm">{t.level}</strong>
          </div>
        </div>
      </div>

      <blockquote className="mt-4 text-[15px] text-foreground leading-relaxed flex-1">
        “{t.quote}”
      </blockquote>

      <div className="mt-4 flex items-center gap-1" aria-label="5 de 5 estrellas">
        {[0, 1, 2, 3, 4].map(i => (
          <svg key={i} width="14" height="14" viewBox="0 0 24 24" className="text-amber-400" fill="currentColor" aria-hidden>
            <path d="M12 2.5l2.83 6.49 7.07.62-5.36 4.7 1.6 6.92L12 17.6l-6.14 3.63 1.6-6.92L2.1 9.61l7.07-.62L12 2.5z" />
          </svg>
        ))}
      </div>
    </figure>
  );
}
