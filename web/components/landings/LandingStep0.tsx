"use client";

/**
 * "Paso 0" del funnel — presentación full-screen específica de cada
 * landing. Mantiene el ESTILO PREPLY del resto del funnel: panel de
 * ilustración a la izquierda (desktop) o arriba (mobile), contenido a
 * la derecha (desktop) o debajo (mobile). Tras pulsar el CTA monta
 * el DiagnosticoFunnel con el preset correspondiente y desaparece.
 *
 * Decisión Gelfis 2026-06-12: full-funnel feel, no landing scrollable.
 * Iconos/emojis con moderación para humanizar sin distraer.
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
  /** Bullets de ventaja específicos de la landing — 2-4 idealmente.
   *  Cada uno puede empezar con un emoji para humanizar. */
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
    <div className="min-h-[100dvh] flex flex-col md:flex-row bg-white"
         style={{ overscrollBehavior: "contain" }}>

      {/* ═══ Panel izquierdo (desktop) / banda superior (mobile)
          con la ilustración + fondo pastel cálido. Igual que el
          resto del funnel para coherencia Preply. ═══ */}
      <aside
        className="relative w-full md:w-1/2 md:min-h-[100dvh]
                   bg-gradient-to-br from-rose-50 via-orange-50 to-amber-50
                   flex items-center justify-center
                   py-6 md:py-12
                   border-b md:border-b-0 md:border-r border-rose-100"
      >
        <div className="w-full max-w-xs md:max-w-md px-6">
          <IllustrationWelcome />
        </div>
      </aside>

      {/* ═══ Panel derecho (desktop) / contenido (mobile) ═══ */}
      <section className="flex-1 md:w-1/2 flex flex-col">

        {/* Header compacto con brand + progreso visual */}
        <header
          className="sticky top-0 z-40 backdrop-blur bg-white/95 border-b border-slate-100"
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
                         mx-auto max-w-xl w-full">

          {/* Badge de recompensa GRATIS */}
          <div className="inline-flex items-center gap-1.5 rounded-full bg-warm/20 text-warm-foreground
                          px-3 py-1 text-[12px] font-semibold mb-3">
            <span aria-hidden>🎁</span>
            <span>Termina el quiz y te llevas tu <strong>clase de prueba GRATIS</strong></span>
          </div>

          {/* H1 — keyword target server-rendered para SEO */}
          <h1 className="text-[26px] sm:text-[30px] md:text-[32px] lg:text-[38px]
                         font-extrabold tracking-tight text-slate-900 leading-tight">
            {h1}
          </h1>

          {/* Subtítulo */}
          <p className="mt-3 text-[15px] md:text-[16px] text-slate-700 leading-relaxed">
            {subtitle}
          </p>

          {/* Ventajas genéricas (mismas en las 6 landings) con emojis
              concretos a la izquierda — humanizan sin saturar. */}
          <ul className="mt-5 space-y-2 md:space-y-2.5">
            <li className="flex items-start gap-2.5 text-[14.5px] md:text-[15px] text-slate-700">
              <span className="text-[18px] leading-tight shrink-0" aria-hidden>🏠</span>
              <span><strong>Aprende alemán desde casa</strong> con profesor nativo que habla español</span>
            </li>
            <li className="flex items-start gap-2.5 text-[14.5px] md:text-[15px] text-slate-700">
              <span className="text-[18px] leading-tight shrink-0" aria-hidden>🇩🇪</span>
              <span><strong>Prepárate para trabajar o vivir</strong> en Alemania, Suiza o Austria</span>
            </li>
            {/* Bullets específicas de la landing — bullets traen su propio
                emoji al inicio si quieren. Para mantener jerarquía visual
                usamos el mismo check warm como icono fijo. */}
            {bullets.map((b, i) => (
              <li key={i} className="flex items-start gap-2.5 text-[14.5px] md:text-[15px] text-slate-700">
                <span className="mt-[3px] text-warm-foreground font-bold shrink-0" aria-hidden>✓</span>
                <span>{b}</span>
              </li>
            ))}
          </ul>

          {/* Pricing — destacando la clase GRATIS */}
          <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50/60 p-4 md:p-5">
            <p className="text-[13.5px] md:text-[14px] text-slate-700 leading-snug">
              <span className="mr-1" aria-hidden>💶</span>
              Sesiones desde <strong className="text-slate-900">18 €/hora</strong>
              {" "}y packs flexibles desde <strong className="text-slate-900">280 €</strong>.
            </p>
            <p className="mt-2.5 inline-flex items-center gap-1.5 rounded-full
                          bg-warm text-warm-foreground px-3 py-1.5
                          text-[12.5px] md:text-[13px] font-bold">
              <span aria-hidden>🎁</span>
              <span>Primera clase de prueba GRATIS</span>
            </p>
          </div>

          {/* Rating con 5 estrellas + +500 alumnos + verificado */}
          <div className="mt-5 flex items-center gap-2 text-[13.5px] md:text-[14px] text-slate-700">
            <span className="text-amber-500 leading-none tracking-tighter text-[15px]" aria-hidden>★★★★★</span>
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
                         shadow-lg shadow-warm/25 active:scale-[0.98] transition
                         inline-flex items-center justify-center gap-1.5"
            >
              <span>Empezar ahora</span>
              <span aria-hidden>→</span>
            </button>
            <p className="mt-2 text-center text-[11.5px] text-slate-500 leading-snug">
              ⏱️ Toma 60 segundos · 💳 Sin tarjeta · 🤝 Sin compromiso
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

/**
 * Ilustración del paso 0 — escena "bienvenida": laptop con bandera
 * alemana en la pantalla, libreta + lápiz, burbuja de saludo. Misma
 * paleta brand que las del resto del funnel (rose/amber/warm).
 */
function IllustrationWelcome() {
  return (
    <svg viewBox="0 0 280 280" className="w-full h-auto max-h-[200px] md:max-h-[400px]" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      {/* Sombra base */}
      <ellipse cx="140" cy="240" rx="100" ry="9" fill="#0f172a" opacity="0.08" />

      {/* Laptop */}
      <g transform="translate(50 95)">
        {/* Base teclado */}
        <rect x="0" y="95" width="180" height="14" rx="3" fill="#1e293b" />
        <rect x="78" y="95" width="24" height="4" rx="1" fill="#475569" />
        {/* Pantalla */}
        <rect x="10" y="0" width="160" height="100" rx="6" fill="#1e293b" />
        <rect x="16" y="6" width="148" height="88" rx="3" fill="#fff7ed" />
        {/* Bandera alemana en pantalla */}
        <g transform="translate(40 24)">
          <rect x="0" y="0"  width="100" height="16" fill="#1e293b" />
          <rect x="0" y="16" width="100" height="16" fill="#dc2626" />
          <rect x="0" y="32" width="100" height="16" fill="#fbbf24" />
        </g>
        {/* "Hallo!" texto */}
        <text x="100" y="86" fontSize="11" fontWeight="800" fill="#92400e" textAnchor="middle">¡Hallo!</text>
      </g>

      {/* Burbuja de chat arriba derecha */}
      <g transform="translate(195 35)">
        <rect x="0" y="0" width="60" height="42" rx="14" fill="#ffffff" stroke="#f97316" strokeWidth="2.5" />
        <path d="M12 32 L4 46 L20 36 Z" fill="#ffffff" stroke="#f97316" strokeWidth="2.5" strokeLinejoin="round" />
        <text x="30" y="27" fontSize="13" fontWeight="800" fill="#f97316" textAnchor="middle">DE</text>
      </g>

      {/* Libreta + lápiz abajo a la izquierda */}
      <g transform="translate(15 175)">
        <rect x="0" y="0" width="60" height="50" rx="4" fill="#fde68a" stroke="#f59e0b" strokeWidth="2" />
        <line x1="10" y1="14" x2="50" y2="14" stroke="#f59e0b" strokeWidth="1.5" opacity="0.6" />
        <line x1="10" y1="24" x2="45" y2="24" stroke="#f59e0b" strokeWidth="1.5" opacity="0.6" />
        <line x1="10" y1="34" x2="50" y2="34" stroke="#f59e0b" strokeWidth="1.5" opacity="0.6" />
        {/* Lápiz cruzado */}
        <g transform="rotate(-25 70 25)">
          <rect x="58" y="0" width="6" height="44" rx="1" fill="#f97316" />
          <polygon points="58,44 64,44 61,52" fill="#1e293b" />
          <rect x="58" y="0" width="6" height="8" fill="#fbbf24" />
        </g>
      </g>

      {/* Estrellita brillo arriba izquierda */}
      <g transform="translate(35 50)">
        <polygon points="0,-10 3,-3 10,-2 4,2 6,10 0,5 -6,10 -4,2 -10,-2 -3,-3" fill="#fbbf24" />
      </g>

      {/* Bombilla pequeña — idea */}
      <g transform="translate(225 145)">
        <circle cx="0" cy="0" r="14" fill="#fde68a" stroke="#f59e0b" strokeWidth="2.5" />
        <rect x="-4" y="13" width="8" height="5" rx="1" fill="#94a3b8" />
        <path d="M-5 -5 L-3 -7 M0 -10 V-6 M5 -5 L3 -7" stroke="#f59e0b" strokeWidth="1.5" strokeLinecap="round" />
      </g>
    </svg>
  );
}
