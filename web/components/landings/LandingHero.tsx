/**
 * Hero compacto para las landings dedicadas (Gelfis 2026-06-XX).
 *
 * Cada landing aterriza con un H1 + subtítulo + value bullets que
 * contienen la keyword target — esto es lo que Google indexa para
 * que la "Experiencia en la página de destino" pase de Inferior al
 * promedio a Promedio/Superior y mejore el Ad Rank.
 *
 * Debajo del hero va el <DiagnosticoFunnel /> embebido — el CTA del
 * hero hace scroll suave al funnel para minimizar fricción.
 */
import { type ReactNode } from "react";

export type LandingHeroProps = {
  /** H1 con la keyword exacta. */
  h1:       string;
  /** Subtítulo conversacional bajo el H1. */
  subtitle: string;
  /** Bullets de valor — 3-4 idealmente. Cada uno con icon + texto. */
  bullets:  ReactNode[];
  /** Texto de la nota de confianza (debajo de los bullets). */
  trustLine?: string;
};

export function LandingHero({
  h1, subtitle, bullets, trustLine,
}: LandingHeroProps) {
  return (
    <section
      aria-label="Resumen de la oferta"
      className="bg-gradient-to-br from-rose-50 via-orange-50 to-amber-50
                 px-5 md:px-8 lg:px-10 py-8 md:py-12 lg:py-16
                 border-b border-amber-100"
    >
      <div className="mx-auto max-w-3xl">
        {/* Badge de recompensa — repetido aquí para coherencia con el
            funnel + para reforzar la promesa antes incluso del H1. */}
        <div className="inline-flex items-center gap-1.5 rounded-full bg-warm/20 text-warm-foreground
                        px-3 py-1 text-[12px] font-semibold mb-4">
          <span aria-hidden>🎁</span>
          <span>Termina el quiz y te llevas tu <strong>clase de prueba GRATIS</strong></span>
        </div>
        <h1 className="text-[28px] sm:text-3xl md:text-[34px] lg:text-[40px]
                       font-extrabold tracking-tight text-slate-900 leading-tight">
          {h1}
        </h1>
        <p className="mt-3 text-[15px] md:text-[16px] lg:text-[17px] text-slate-700 leading-relaxed">
          {subtitle}
        </p>
        <ul className="mt-5 md:mt-6 space-y-2 md:space-y-2.5">
          {bullets.map((b, i) => (
            <li key={i} className="flex items-start gap-2 text-[14.5px] md:text-[15px] text-slate-700">
              <span className="mt-[2px] text-warm-foreground font-bold shrink-0" aria-hidden>✓</span>
              <span>{b}</span>
            </li>
          ))}
        </ul>
        {trustLine && (
          <p className="mt-5 text-[13px] text-slate-500 italic leading-snug">
            {trustLine}
          </p>
        )}
        <div className="mt-6 md:mt-8">
          <a
            href="#empezar"
            className="inline-flex items-center justify-center h-12 md:h-13 px-6 md:px-8 rounded-2xl
                       bg-warm text-warm-foreground font-semibold text-[15px] md:text-[16px]
                       shadow-lg shadow-warm/25 active:scale-[0.98] transition"
          >
            Empezar ahora →
          </a>
          <p className="mt-2 text-[12px] text-slate-500">
            Toma 60 segundos · Sin compromiso
          </p>
        </div>
      </div>
    </section>
  );
}
