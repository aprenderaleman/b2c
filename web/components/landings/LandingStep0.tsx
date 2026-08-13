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
import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { BrandLogo } from "@/components/BrandLogo";
import { captureAttributionFromUrl } from "@/lib/ads-attribution";
import { trackFunnel } from "@/lib/track-funnel";
import type { MotivoId } from "@/components/diagnostico/DiagnosticoFunnel";

/** Bullet de ventaja con icono propio (Gelfis 2026-06-14: TODAS las
 *  features tienen que tener icono, no solo "desde casa"). */
export type LandingBullet = { icon: string; text: ReactNode };

export type LandingStep0Props = {
  /** H1 con la keyword target. */
  h1:       string;
  /** Subtítulo conversacional bajo el H1. */
  subtitle: string;
  /** Bullets específicos de la landing. Por defecto la lista se
   *  prepende con los 2 fijos (🏠 desde casa, 🗺️ DACH). Si el caller
   *  pasa `bulletsMode: "replace"`, la lista se usa tal cual (para
   *  landings paid que reordenan los mensajes). */
  bullets:  Array<LandingBullet | ReactNode>;
  bulletsMode?: "prepend" | "replace";
  /** Preset del motivo (si la intención de la landing es inequívoca). */
  presetMotivo?: MotivoId | null;
  /** Slug de la landing — se propaga a tracking. */
  landingIntent: string;
  /** Texto del botón CTA. Default: "Reservar Clase de Alemán". */
  ctaLabel?: string;
  /** Sección opcional entre los bullets y el bloque amber. Usado por
   *  landings paid para insertar prueba social sin bloatear el
   *  componente. Se muestra tanto en desktop como en mobile. */
  afterBullets?: ReactNode;
  /** Href override del CTA. Default: /agendar/cuando?landing=... */
  ctaHref?: string;
  /** Microcopy bajo el botón. Default: "Sin tarjeta — Agenda tu Clase gratis". */
  microcopy?: string;
  /** Bloque opcional bajo el microcopy — usado para propuesta de valor
   *  extra (e.g. "¿Por qué 10€?" en la variante paid). */
  belowCtaNote?: ReactNode;
  /** Píldora opcional sobre el H1 (e.g. "Clase de prueba · Agenda Prioritaria 10€"). */
  tagline?: string;
};

function isBullet(b: unknown): b is LandingBullet {
  return Boolean(b && typeof b === "object" && "icon" in b && "text" in b);
}

export function LandingStep0({
  h1, subtitle, bullets, bulletsMode = "prepend",
  presetMotivo = null, landingIntent,
  ctaLabel = "Reservar Clase de Alemán",
  afterBullets = null,
  ctaHref: ctaHrefOverride,
  microcopy = "Sin tarjeta — Agenda tu Clase gratis",
  belowCtaNote = null,
  tagline,
}: LandingStep0Props) {
  // El CTA verde dirige a /agendar/cuando?landing={slug}&motivo={x}
  // para preservar atribución (Gelfis 2026-06-15). /agendar/cuando
  // pasa esos params al body de book-trial, que setea
  // leads.landing_intent + leads.motivo_inicial directos.

  // Captura de gclid/utm al aterrizar en la landing. Sobrevive en
  // sessionStorage para que /agendar/cuando lo recupere al confirmar.
  useEffect(() => {
    captureAttributionFromUrl();
    // Instrumentación funnel (Gelfis 2026-07-19): landing_view + slug.
    trackFunnel("landing_view", { landingIntent });
  }, [landingIntent]);

  // Banner de referido: si llega ?ref={code} válido, mostramos quién
  // invita (solo nombre de pila, por privacidad). Código inválido →
  // landing normal, sin banner y sin error. El copy promete la clase
  // extra SOLO al inscribirse (honestidad del incentivo).
  const [referrerName, setReferrerName] = useState<string | null>(null);
  useEffect(() => {
    try {
      const code = new URLSearchParams(window.location.search).get("ref")
        ?? sessionStorage.getItem("b2c.attr.ref");
      if (!code) return;
      fetch(`/api/public/referral-info?code=${encodeURIComponent(code)}`)
        .then(r => r.ok ? r.json() : null)
        .then((d: { valid: boolean; first_name?: string } | null) => {
          if (d?.valid && d.first_name) setReferrerName(d.first_name);
        })
        .catch(() => {});
    } catch { /* sessionStorage bloqueado */ }
  }, []);

  // Href único (evita duplicar la URL entre el CTA inline y el sticky).
  const ctaHref = ctaHrefOverride
    ?? `/agendar/cuando?landing=${encodeURIComponent(landingIntent)}${presetMotivo ? `&motivo=${encodeURIComponent(presetMotivo)}` : ""}`;

  return (
    <div className="min-h-[100dvh] flex flex-col bg-white"
         style={{ overscrollBehavior: "contain" }}>

      {/* ═══ Header full-width — ocupa todo el ancho horizontal con
            el logo CENTRADO (Gelfis 2026-06-14). Logo = imagen +
            wordmark "Aprender-Aleman.de" con ".de" en naranja. ═══ */}
      <header
        className="sticky top-0 z-40 backdrop-blur bg-white/95 border-b border-slate-100 w-full"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <div className="flex items-center justify-center h-14 md:h-16 px-4">
          <BrandLogo size="md" />
        </div>
        {/* Barra de progreso — 0% al inicio para reforzar "estás empezando". */}
        <div className="h-1 w-full bg-slate-100">
          <div className="h-full bg-warm transition-[width] duration-300" style={{ width: "0%" }} />
        </div>
      </header>

      {/* ═══ Cuerpo: 2 columnas en desktop (ilustración + contenido),
            apiladas en mobile. Antes el header vivía DENTRO de la
            columna derecha; ahora es full-width arriba. ═══ */}
      <div className="flex-1 flex flex-col md:flex-row">

      {/* ═══ Panel izquierdo (desktop) / banda superior (mobile)
          con la ilustración + fondo pastel cálido. Igual que el
          resto del funnel para coherencia Preply. ═══ */}
      <aside
        className="relative w-full md:w-1/2
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

        <main className="flex-1 px-5 md:px-8 lg:px-10 py-6 md:py-10
                         mx-auto max-w-xl w-full
                         pb-28 md:pb-10">

          {/* Banner de referido — solo cuando ?ref es válido. */}
          {referrerName && (
            <div className="mb-4 rounded-2xl border border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50 px-4 py-3 text-sm text-amber-900 leading-relaxed">
              🎁 <strong>{referrerName} te invitó a Aprender-Alemán</strong> — agenda
              tu clase de prueba gratis y, si te inscribes, llévate una clase
              extra de regalo en tu programa.
            </div>
          )}

          {/* Tagline píldora opcional (variante paid: "Clase de prueba · 10€"). */}
          {tagline && (
            <p className="mb-2 inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-900 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider">
              {tagline}
            </p>
          )}
          {/* H1 — keyword target server-rendered para SEO */}
          <h1 className="text-[26px] sm:text-[30px] md:text-[32px] lg:text-[38px]
                         font-extrabold tracking-tight text-slate-900 leading-tight">
            {h1}
          </h1>

          {/* Subtítulo */}
          <p className="mt-3 text-[15px] md:text-[16px] text-slate-700 leading-relaxed">
            {subtitle}
          </p>

          {/* Ventajas — todas con icono propio (Gelfis 2026-06-14: no
              más check ✓ genérico). En modo "prepend" añadimos los 2
              fijos (desde casa, DACH); en "replace" solo se usan los
              del caller (para reordenar mensaje en landings paid). */}
          <ul className="mt-5 space-y-2 md:space-y-2.5">
            {bulletsMode === "prepend" && (
              <>
                <li className="flex items-start gap-2.5 text-[14.5px] md:text-[15px] text-slate-700">
                  <span className="text-[18px] leading-tight shrink-0" aria-hidden>🏠</span>
                  <span><strong>Aprende alemán desde casa</strong> con profesor nativo que habla español</span>
                </li>
                <li className="flex items-start gap-2.5 text-[14.5px] md:text-[15px] text-slate-700">
                  {/* Antes 🇩🇪 (regional indicator) — no renderiza bien
                      en Windows sin font de banderas. 🗺️ funciona en
                      todas las plataformas y representa "destinos DACH". */}
                  <span className="text-[18px] leading-tight shrink-0" aria-hidden>🗺️</span>
                  <span><strong>Prepárate para trabajar o vivir</strong> en Alemania, Suiza o Austria</span>
                </li>
              </>
            )}
            {bullets.map((b, i) => {
              const icon = isBullet(b) ? b.icon : "✨";
              const text = isBullet(b) ? b.text : b;
              return (
                <li key={i} className="flex items-start gap-2.5 text-[14.5px] md:text-[15px] text-slate-700">
                  <span className="text-[18px] leading-tight shrink-0" aria-hidden>{icon}</span>
                  <span>{text}</span>
                </li>
              );
            })}
          </ul>

          {/* Sección opcional (prueba social, testimonios, etc.) que
              landings paid inyectan entre bullets y bloque de cierre. */}
          {afterBullets}

          {/* belowCtaNote mobile-only (el amber card está md:hidden, así
              que sin este bloque el mensaje "¿Por qué 10€?" no se ve
              en mobile). Se renderiza también dentro del amber card
              para desktop. */}
          {belowCtaNote && (
            <div className="md:hidden mt-6 rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
              {belowCtaNote}
            </div>
          )}

          {/* CTA principal — visible SOLO en desktop (hidden md:block).
              En mobile el único CTA es el sticky bottom (Gelfis
              2026-07-21) para no duplicar botones. Card pastel con
              propuesta de valor + botón + microcopy. */}
          <div className="hidden md:block mt-6 rounded-2xl border border-amber-200 bg-amber-50/60 p-4 md:p-5">
            <p className="text-[14px] md:text-[15px] text-slate-700 leading-relaxed">
              Antes de invertir en cualquier curso, vívelo. Una clase real
              con un profesor nativo, una conversación honesta sobre tu
              nivel y un plan diseñado para ti.
            </p>
            <Link
              href={ctaHref}
              onClick={() => trackFunnel("cta_click", { landingIntent })}
              className="mt-4 inline-flex items-center justify-center gap-2 w-full
                         h-12 md:h-13 lg:h-14 rounded-2xl
                         bg-emerald-600 hover:bg-emerald-700 text-white
                         text-[15px] md:text-[16px] lg:text-[17px] font-bold
                         shadow-lg shadow-emerald-600/30
                         active:scale-[0.98] transition"
            >
              <span aria-hidden>🎁</span>
              <span>{ctaLabel}</span>
            </Link>
            <p className="mt-2 text-center text-[11.5px] text-slate-600 leading-snug">
              {microcopy}
            </p>
            {belowCtaNote && (
              <div className="mt-3 pt-3 border-t border-amber-200/60">
                {belowCtaNote}
              </div>
            )}
          </div>

          {/* Rating con 5 estrellas + +500 alumnos + verificado */}
          <div className="mt-5 flex items-center justify-center gap-2 text-[13.5px] md:text-[14px] text-slate-700">
            <span className="text-amber-500 leading-none tracking-tighter text-[15px]" aria-hidden>★★★★★</span>
            <span><strong>+500 alumnos</strong> nos valoran</span>
            <svg viewBox="0 0 20 20" className="h-4 w-4 text-emerald-600" aria-hidden>
              <path fill="currentColor" d="M10 1.5l2.4 2.1 3.1-.6.6 3.1 2.1 2.4-2.1 2.4-.6 3.1-3.1-.6L10 15.5l-2.4-2.1-3.1.6-.6-3.1L1.8 8.5l2.1-2.4.6-3.1 3.1.6L10 1.5z"/>
              <path fill="white" d="M8.6 11.1L6.5 9l-1 1 3.1 3.1 6.1-6.1-1-1z"/>
            </svg>
            <span className="text-[12px] text-emerald-700 font-semibold">verificado</span>
          </div>
        </main>

      </section>
      </div>

      {/* ═══ Sticky bottom CTA — SOLO MOBILE (Gelfis 2026-07-21,
            reintroducido). Flotante para maximizar clicks sin que el
            usuario tenga que scrollear al inline. Respeta safe-area del
            iPhone. En desktop queda oculto (el inline ya es visible
            arriba del fold). ═══ */}
      <div
        className="md:hidden fixed inset-x-0 bottom-0 z-50
                   bg-white/95 backdrop-blur border-t border-slate-200
                   px-4 pt-3"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 24px)" }}
      >
        {/* Botón sticky con "pulse ring" (Gelfis 2026-07-21): un aro
            emerald late detrás del botón — señal universal de "aquí se
            hace click" sin necesidad de texto explícito. La flecha →
            hace un pequeño loop lateral para reforzar la affordance. */}
        <div className="relative">
          <span
            aria-hidden
            className="absolute inset-0 rounded-2xl bg-emerald-500/40 pointer-events-none"
            style={{ animation: "ctaPulseRing 1.8s ease-out infinite" }}
          />
          <Link
            href={ctaHref}
            onClick={() => trackFunnel("cta_click", { landingIntent })}
            className="relative inline-flex items-center justify-center gap-2 w-full
                       h-12 rounded-2xl
                       bg-emerald-600 hover:bg-emerald-700 text-white
                       text-[15px] font-bold
                       shadow-lg shadow-emerald-600/30
                       active:scale-[0.98] transition"
          >
            <span aria-hidden>🎁</span>
            <span>{ctaLabel}</span>
            <span
              aria-hidden
              className="text-[17px] leading-none"
              style={{ animation: "ctaArrowNudge 1.4s ease-in-out infinite" }}
            >→</span>
          </Link>
        </div>
      </div>
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

      {/* Laptop — outer mantiene posición SVG, inner anima (CSS transform
          pisa el SVG transform attr, por eso separamos en dos g's). */}
      <g transform="translate(50 95)">
        <g style={{ animation: "illoDropIn 520ms ease-out both" }}>
          {/* Base teclado */}
          <rect x="0" y="95" width="180" height="14" rx="3" fill="#1e293b" />
          <rect x="78" y="95" width="24" height="4" rx="1" fill="#475569" />
          {/* Pantalla */}
          <rect x="10" y="0" width="160" height="100" rx="6" fill="#1e293b" />
          <rect x="16" y="6" width="148" height="88" rx="3" fill="#fff7ed" />
          {/* Bandera alemana en pantalla — fade in */}
          <g transform="translate(40 24)">
            <g style={{ animation: "illoFadeIn 380ms 550ms ease-out both" }}>
              <rect x="0" y="0"  width="100" height="16" fill="#1e293b" />
              <rect x="0" y="16" width="100" height="16" fill="#dc2626" />
              <rect x="0" y="32" width="100" height="16" fill="#fbbf24" />
            </g>
          </g>
          {/* "Hallo!" texto — fade in tras la bandera */}
          <text x="100" y="86" fontSize="11" fontWeight="800" fill="#92400e" textAnchor="middle" style={{ animation: "illoFadeIn 380ms 900ms ease-out both" }}>¡Hallo!</text>
        </g>
      </g>

      {/* Burbuja "DE" — pop in + float loop infinito */}
      <g transform="translate(195 35)">
        <g style={{ animation: "illoPopIn 420ms 750ms cubic-bezier(.34,1.56,.64,1) both, illoFloat 3.2s 1250ms ease-in-out infinite" }}>
          <rect x="0" y="0" width="60" height="42" rx="14" fill="#ffffff" stroke="#f97316" strokeWidth="2.5" />
          <path d="M12 32 L4 46 L20 36 Z" fill="#ffffff" stroke="#f97316" strokeWidth="2.5" strokeLinejoin="round" />
          <text x="30" y="27" fontSize="13" fontWeight="800" fill="#f97316" textAnchor="middle">DE</text>
        </g>
      </g>

      {/* Libreta + lápiz — slide in desde la izquierda */}
      <g transform="translate(15 175)">
        <g style={{ animation: "illoSlideInLeft 500ms 600ms cubic-bezier(.34,1.4,.64,1) both" }}>
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
      </g>

      {/* Estrellita — pop + twinkle loop */}
      <g transform="translate(35 50)">
        <g style={{ animation: "illoPopIn 360ms 1100ms cubic-bezier(.34,1.56,.64,1) both, illoTwinkle 2.4s 1500ms ease-in-out infinite" }}>
          <polygon points="0,-10 3,-3 10,-2 4,2 6,10 0,5 -6,10 -4,2 -10,-2 -3,-3" fill="#fbbf24" />
        </g>
      </g>

      {/* Bombilla — pop + twinkle loop (la idea brilla) */}
      <g transform="translate(225 145)">
        <g style={{ animation: "illoPopIn 420ms 1300ms cubic-bezier(.34,1.56,.64,1) both, illoTwinkle 2.6s 1750ms ease-in-out infinite" }}>
          <circle cx="0" cy="0" r="14" fill="#fde68a" stroke="#f59e0b" strokeWidth="2.5" />
          <rect x="-4" y="13" width="8" height="5" rx="1" fill="#94a3b8" />
          <path d="M-5 -5 L-3 -7 M0 -10 V-6 M5 -5 L3 -7" stroke="#f59e0b" strokeWidth="1.5" strokeLinecap="round" />
        </g>
      </g>
    </svg>
  );
}
