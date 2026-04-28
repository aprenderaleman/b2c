"use client";

import Link from "next/link";
import { useLang } from "@/lib/lang-context";

const COPY = {
  es: {
    pill:    "100% gratis · 45 min · sin tarjeta",
    titlePre: "Empieza tu alemán ",
    titleAccent: "esta semana",
    sub:     "En 45 minutos un profesor nativo te evalúa el nivel, te arma un plan a medida y te dice exactamente cuánto vas a tardar en llegar a tu objetivo. Sin compromiso.",
    cta:     "Reservar mi clase de prueba",
    back:    "Volver arriba",
    guarantee: "Si no llegas a tu objetivo en el plazo acordado, repites las clases que falten sin coste.",
    guaranteeLabel: "Resultados garantizados.",
  },
  de: {
    pill:    "100% gratis · 45 Min · keine Karte",
    titlePre: "Starte dein Deutsch ",
    titleAccent: "diese Woche",
    sub:     "In 45 Minuten schätzt eine muttersprachliche Lehrkraft dein Niveau ein, erstellt einen Plan nach Maß und sagt dir, wie lange du brauchst, um dein Ziel zu erreichen. Unverbindlich.",
    cta:     "Probestunde buchen",
    back:    "Nach oben",
    guarantee: "Erreichst du dein Ziel nicht im vereinbarten Zeitraum, holst du die fehlenden Stunden kostenlos nach.",
    guaranteeLabel: "Garantierte Ergebnisse.",
  },
} as const;

export function FinalCta() {
  const { lang } = useLang();
  const c = COPY[lang === "de" ? "de" : "es"];
  return (
    <section className="hidden md:block relative bg-navy-900 text-white overflow-hidden">
      <div
        aria-hidden
        className="absolute inset-0 opacity-60"
        style={{
          background:
            "radial-gradient(circle at 50% 0%, rgba(244,162,97,0.22) 0%, transparent 55%)",
        }}
      />
      <div className="relative mx-auto max-w-4xl px-6 lg:px-10 py-20 lg:py-24 text-center">
        <span className="inline-flex items-center gap-2 rounded-full
                         bg-warm/15 ring-1 ring-warm/40 text-warm
                         px-3.5 py-1 text-[11px] font-bold uppercase tracking-[0.18em]">
          <span className="h-1.5 w-1.5 rounded-full bg-warm" aria-hidden />
          {c.pill}
        </span>

        <h2 className="mt-5 text-3xl lg:text-[44px] font-bold tracking-tight leading-tight">
          {c.titlePre}<span className="text-warm">{c.titleAccent}</span>
        </h2>
        <p className="mt-4 max-w-2xl mx-auto text-base lg:text-lg text-white/75 leading-relaxed">
          {c.sub}
        </p>

        <div className="mt-8 flex items-center justify-center gap-3 flex-wrap">
          <Link
            href="/agendar/cuando"
            className="inline-flex items-center gap-2 rounded-2xl
                       bg-warm text-warm-foreground font-semibold text-base
                       px-7 h-12 shadow-lg shadow-warm/30 hover:scale-[1.02]
                       active:scale-[0.99] transition"
          >
            {c.cta}
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M5 12h14M13 5l7 7-7 7" />
            </svg>
          </Link>
          <a
            href="#top"
            className="inline-flex items-center gap-2 rounded-2xl
                       bg-white/[0.06] hover:bg-white/[0.12] text-white font-semibold text-sm
                       px-5 h-12 transition"
          >
            {c.back}
          </a>
        </div>

        <p className="mt-6 text-xs text-white/55">
          {c.guarantee} <strong className="text-white/75">{c.guaranteeLabel}</strong>
        </p>
      </div>
    </section>
  );
}
