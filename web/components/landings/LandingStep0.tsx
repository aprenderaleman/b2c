"use client";

/**
 * "Paso 0" del funnel — presentación full-screen específica de cada
 * landing. Tras pulsar el CTA monta el DiagnosticoFunnel con el
 * preset correspondiente y desaparece. Lo que ve el lead es UN sólo
 * paso visual ininterrumpido: presentación → quiz.
 *
 * Decisión Gelfis 2026-06-12: no queremos sección landing + FAQ scrollable
 * porque rompía la sensación de funnel. Sólo un paso 0 con propuesta
 * de valor + pricing + rating + botón único. La única forma de avanzar
 * es el botón.
 *
 * El contenido del paso 0 está server-rendered en el HTML inicial, así
 * que Google sí indexa el H1 + subtítulo + bullets aunque la lógica
 * de "click → funnel" sea cliente.
 */
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { DiagnosticoFunnel, type MotivoId } from "@/components/diagnostico/DiagnosticoFunnel";

export type LandingStep0Props = {
  /** H1 con la keyword target. */
  h1:       string;
  /** Subtítulo conversacional bajo el H1. */
  subtitle: string;
  /** Bullets de ventaja específicos de la landing — 2-4 idealmente. */
  bullets:  ReactNode[];
  /** Preset del motivo (si la intención de la landing es inequívoca). */
  presetMotivo?: MotivoId | null;
  /** Slug de la landing — se propaga a tracking. */
  landingIntent: string;
};

export function LandingStep0({
  h1, subtitle, bullets, presetMotivo = null, landingIntent,
}: LandingStep0Props) {
  const [started, setStarted] = useState(false);

  // Una vez pulsado el CTA, montamos el funnel real. Le pasamos el
  // motivo preset (si lo hay) y el landingIntent para tracking.
  if (started) {
    return <DiagnosticoFunnel presetMotivo={presetMotivo} landingIntent={landingIntent} />;
  }

  return (
    <div className="min-h-[100dvh] bg-gradient-to-br from-rose-50 via-orange-50 to-amber-50
                    flex flex-col"
         style={{ overscrollBehavior: "contain" }}>

      {/* Header compacto con brand + progreso visual (paso 0 de 3). */}
      <header
        className="sticky top-0 z-40 backdrop-blur bg-white/90 border-b border-amber-100"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <div className="mx-auto max-w-xl flex items-center justify-between gap-2 h-14 md:h-16 px-4">
          {/* Sin botón "atrás" — el paso 0 es la entrada. */}
          <span className="h-10 w-10" aria-hidden />
          <Link href="/" aria-label="Aprender-Aleman.de"
                className="font-extrabold tracking-tight text-slate-900 text-[15px]">
            Aprender-Aleman<span className="text-warm">.de</span>
          </Link>
          <span className="text-[11px] font-semibold text-slate-500 tabular-nums">
            Paso <strong className="text-slate-900">1 / 3</strong>
          </span>
        </div>
        {/* Barra de progreso — 0% al inicio para reforzar "estás empezando". */}
        <div className="h-1 w-full bg-slate-100">
          <div className="h-full bg-warm transition-[width] duration-300" style={{ width: "0%" }} />
        </div>
      </header>

      <main className="flex-1 px-5 md:px-8 lg:px-10 py-6 md:py-10
                       mx-auto max-w-3xl w-full">

        {/* Badge de recompensa GRATIS */}
        <div className="inline-flex items-center gap-1.5 rounded-full bg-warm/20 text-warm-foreground
                        px-3 py-1 text-[12px] font-semibold mb-3">
          <span aria-hidden>🎁</span>
          <span>Termina el quiz y te llevas tu <strong>clase de prueba GRATIS</strong></span>
        </div>

        {/* H1 — keyword target server-rendered para SEO */}
        <h1 className="text-[26px] sm:text-[30px] md:text-[34px] lg:text-[40px]
                       font-extrabold tracking-tight text-slate-900 leading-tight">
          {h1}
        </h1>

        {/* Subtítulo */}
        <p className="mt-3 text-[15px] md:text-[16px] lg:text-[17px] text-slate-700 leading-relaxed">
          {subtitle}
        </p>

        {/* Ventajas genéricas (mismas en las 6 landings) — refuerzan el
            posicionamiento sin restar a las bullets específicas. */}
        <ul className="mt-5 space-y-2 md:space-y-2.5">
          <li className="flex items-start gap-2 text-[14.5px] md:text-[15px] text-slate-700">
            <span className="mt-[2px] text-warm-foreground font-bold shrink-0" aria-hidden>✓</span>
            <span><strong>Aprende alemán desde casa</strong> con profesor nativo que habla español</span>
          </li>
          <li className="flex items-start gap-2 text-[14.5px] md:text-[15px] text-slate-700">
            <span className="mt-[2px] text-warm-foreground font-bold shrink-0" aria-hidden>✓</span>
            <span><strong>Prepárate para trabajar o vivir</strong> en Alemania, Suiza o Austria</span>
          </li>
          {/* Bullets específicas de la landing */}
          {bullets.map((b, i) => (
            <li key={i} className="flex items-start gap-2 text-[14.5px] md:text-[15px] text-slate-700">
              <span className="mt-[2px] text-warm-foreground font-bold shrink-0" aria-hidden>✓</span>
              <span>{b}</span>
            </li>
          ))}
        </ul>

        {/* Pricing — destacando la clase GRATIS */}
        <div className="mt-6 rounded-2xl border border-amber-200 bg-white/70 p-4 md:p-5">
          <p className="text-[13px] md:text-[14px] text-slate-700">
            Sesiones desde <strong className="text-slate-900">18 €/hora</strong>
            {" "}y packs flexibles desde <strong className="text-slate-900">280 €</strong>.
          </p>
          <p className="mt-2 inline-flex items-center gap-1.5 rounded-full
                        bg-warm text-warm-foreground px-3 py-1
                        text-[12.5px] md:text-[13px] font-bold">
            <span aria-hidden>🎁</span>
            <span>Primera clase de prueba GRATIS</span>
          </p>
        </div>

        {/* Rating con 5 estrellas + +500 alumnos + verificado */}
        <div className="mt-5 flex items-center gap-2 text-[13.5px] md:text-[14px] text-slate-700">
          <span className="text-amber-500 leading-none" aria-hidden>★★★★★</span>
          <span><strong>+500 alumnos</strong> nos valoran</span>
          <svg viewBox="0 0 20 20" className="h-4 w-4 text-emerald-600" aria-hidden>
            <path fill="currentColor" d="M10 1.5l2.4 2.1 3.1-.6.6 3.1 2.1 2.4-2.1 2.4-.6 3.1-3.1-.6L10 15.5l-2.4-2.1-3.1.6-.6-3.1L1.8 8.5l2.1-2.4.6-3.1 3.1.6L10 1.5z"/>
            <path fill="white" d="M8.6 11.1L6.5 9l-1 1 3.1 3.1 6.1-6.1-1-1z"/>
          </svg>
          <span className="text-[12px] text-emerald-700 font-semibold">verificado</span>
        </div>
      </main>

      {/* CTA fijo abajo — la única forma de avanzar. */}
      <div className="sticky bottom-0 z-30 bg-gradient-to-t from-white via-white/95 to-white/0 pt-6 pb-4
                      px-5 md:px-8"
           style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1rem)" }}>
        <div className="mx-auto max-w-xl">
          <button
            type="button"
            onClick={() => setStarted(true)}
            className="w-full h-12 md:h-13 lg:h-14 rounded-2xl bg-warm text-warm-foreground
                       font-semibold text-base md:text-[16px] lg:text-[17px]
                       shadow-lg shadow-warm/25 active:scale-[0.98] transition"
          >
            Empezar ahora →
          </button>
          <p className="mt-2 text-center text-[11.5px] text-slate-500 leading-snug">
            Toma 60 segundos · Sin tarjeta · Sin compromiso
          </p>
        </div>
      </div>
    </div>
  );
}
