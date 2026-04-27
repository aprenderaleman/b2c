"use client";

import Link from "next/link";
import { useState } from "react";
import { motion } from "framer-motion";
import { Header } from "@/components/Header";
import { WhatsAppFloat } from "@/components/WhatsAppFloat";
import { Funnel } from "@/components/Funnel";
import { useLang } from "@/lib/lang-context";
import { interpolate } from "@/lib/i18n";

/**
 * Aprender-Aleman.de — public landing.
 *
 * Background alternation, fixed in BOTH global modes:
 *   hero       → navy
 *   funnel     → white (light) / near-black (dark)
 *   funnel card→ navy   (always — the booking modal stays navy on top)
 *   FAQ        → white (light) / near-black (dark)
 *   footer     → navy
 *
 * Navy sections always render with white text. White/black sections
 * use the global semantic tokens so dark mode flips them. The funnel
 * card uses `theme-dark` to pin its inner semantic tokens to dark
 * values, so `text-foreground`, `bg-card`, etc. inside the Funnel
 * stay legible against the navy without per-component overrides.
 */
export default function HomePage() {
  const { t } = useLang();

  // The funnel starts at step 1 (calendar). The moment the lead picks
  // a slot and clicks "Siguiente", we collapse the hero + FAQ so the
  // form owns the whole viewport — fewer distractions, higher
  // completion rate. Going "Atrás" back to step 1 restores everything.
  const [funnelStep, setFunnelStep] = useState(1);
  const expanded = funnelStep > 1;

  return (
    <>
      <Header />
      <main>
        {/* ────────── HERO — navy ────────── */}
        {!expanded && (
          <motion.section
            key="hero"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="bg-navy-900 text-white"
          >
            <div className="mx-auto max-w-5xl px-5 sm:px-6 pt-16 sm:pt-24 pb-14 sm:pb-20 text-center">
              <div className="flex flex-col items-center gap-5">
                <span className="inline-flex items-center gap-2 rounded-full
                                 bg-warm/15 ring-1 ring-warm/40
                                 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-warm">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-warm opacity-75"/>
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-warm"/>
                  </span>
                  {t.home.tagline}
                </span>

                <h1 className="font-bold tracking-tight text-white
                               text-4xl md:text-[56px] lg:text-[60px] leading-[1.05]
                               max-w-3xl">
                  {renderBold(t.home.title)}
                </h1>

                <p className="max-w-2xl text-lg md:text-xl
                              font-medium text-white/75 leading-relaxed">
                  {renderBold(t.home.subtitle)}
                </p>

                <RatingBadge />
              </div>
            </div>
          </motion.section>
        )}

        {/* ────────── MOBILE CTA — only visible below md ────────── */}
        {/*
          Mobile visitors see a focused single-CTA card that launches
          the new app-shell funnel at /agendar. Keeps the homepage
          uncluttered (most traffic is mobile) and lets the funnel own
          the full viewport once they tap. Desktop is unchanged.
        */}
        <section className="md:hidden bg-white dark:bg-slate-950">
          <div className="mx-auto max-w-2xl px-5 py-10">
            <Link
              href="/agendar"
              className="block w-full rounded-3xl bg-navy-900 text-white p-6 shadow-lg
                         active:scale-[0.99] transition border border-navy-700"
            >
              <div className="flex flex-col items-start gap-3">
                <span className="inline-flex items-center gap-2 rounded-full bg-warm/15 ring-1 ring-warm/40
                                 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-warm">
                  Gratis · 45 min
                </span>
                <span className="text-2xl font-extrabold leading-tight">
                  Reserva tu clase de prueba
                </span>
                <span className="text-sm text-white/70">
                  Elige día y hora en menos de un minuto.
                </span>
                <span className="mt-2 inline-flex items-center gap-2 rounded-2xl
                                 bg-warm text-warm-foreground font-semibold text-base
                                 px-5 h-12 self-stretch justify-center shadow-md shadow-warm/20">
                  Empezar
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M5 12h14M13 5l7 7-7 7" />
                  </svg>
                </span>
              </div>
            </Link>
          </div>
        </section>

        {/* ────────── FUNNEL section (desktop only) ────────── */}
        <section
          id="reservar"
          className="hidden md:block bg-white dark:bg-slate-950"
        >
          <div
            className={`mx-auto px-4 sm:px-6 transition-[max-width,padding] duration-300 ease-out ${
              expanded
                ? "max-w-3xl pt-12 sm:pt-16 pb-16 sm:pb-24 min-h-[calc(100vh-4rem)]"
                : "max-w-2xl py-12 sm:py-16"
            }`}
          >
            {/* Booking modal — navy in BOTH modes. `theme-dark` pins the
                inner semantic tokens to dark so `bg-card`, `text-foreground`,
                `border-border` etc. inside the Funnel are coherent. */}
            <div className="theme-dark rounded-3xl bg-navy-900 text-white border border-navy-700 shadow-lg p-5 sm:p-7">
              <Funnel embedded onStepChange={setFunnelStep} />
            </div>
            {!expanded && (
              <p className="mt-4 text-center text-xs text-muted-foreground">
                {t.home.ctaHint}
              </p>
            )}
          </div>
        </section>

        {/* ────────── FAQ — white / near-black ────────── */}
        {!expanded && (
          <motion.section
            key="faq"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="bg-white dark:bg-slate-950"
          >
            <div className="mx-auto max-w-3xl px-5 sm:px-6 py-14 sm:py-20">
              <SectionHeader title={t.home.faqTitle} />
              <div className="mt-8 flex flex-col gap-3">
                <FaqItem q={t.home.faq1Q} a={t.home.faq1A} />
                <FaqItem q={t.home.faq2Q} a={t.home.faq2A} />
                <FaqItem q={t.home.faq3Q} a={t.home.faq3A} />
                <FaqItem q={t.home.faq4Q} a={t.home.faq4A} />
                <FaqItem q={t.home.faq5Q} a={t.home.faq5A} />
              </div>
            </div>
          </motion.section>
        )}

        {/* ────────── FOOTER — navy ────────── */}
        {!expanded && (
          <footer className="bg-navy-900 text-white border-t border-navy-700">
            <div className="mx-auto max-w-6xl px-5 sm:px-6 py-8 flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-6 text-sm text-white/70">
              <span>{interpolate(t.home.footer, { year: new Date().getFullYear() })}</span>
              <span className="hidden sm:inline">·</span>
              <Link href="/privacy" className="hover:text-warm underline-offset-4 hover:underline transition-colors">
                {t.step4.gdprLink}
              </Link>
            </div>
          </footer>
        )}
      </main>
      {!expanded && <WhatsAppFloat />}
    </>
  );
}

// ─────────────────────────────────────────────────────────
// Building blocks
// ─────────────────────────────────────────────────────────

/**
 * 5-star rating + "Academia de Alemán" — sits below the hero subtitle.
 * Stars use a soft amber-300 fill with a glow; the "Alemán" word picks
 * up the warm accent so it ties to the rest of the brand palette.
 */
function RatingBadge() {
  return (
    <div className="mt-1 inline-flex items-center gap-3 rounded-full
                    bg-white/[0.04] ring-1 ring-white/10
                    px-5 py-2.5 backdrop-blur-sm">
      <span className="flex items-center gap-0.5" aria-label="5 de 5 estrellas">
        {[0, 1, 2, 3, 4].map((i) => (
          <svg
            key={i}
            width="18" height="18" viewBox="0 0 24 24"
            className="text-amber-300 drop-shadow-[0_0_8px_rgba(252,211,77,0.45)]"
            fill="currentColor" aria-hidden
          >
            <path d="M12 2.5l2.83 6.49 7.07.62-5.36 4.7 1.6 6.92L12 17.6l-6.14 3.63 1.6-6.92L2.1 9.61l7.07-.62L12 2.5z" />
          </svg>
        ))}
      </span>
      <span className="h-4 w-px bg-white/15" aria-hidden />
      <span className="text-sm font-semibold tracking-wide text-white">
        Academia de <span className="text-warm">Alemán</span>
      </span>
    </div>
  );
}

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="text-center">
      <h2 className="text-3xl md:text-[42px] font-bold tracking-tight text-foreground">
        {title}
      </h2>
      {subtitle && (
        <p className="mt-2 text-sm sm:text-base text-muted-foreground">
          {subtitle}
        </p>
      )}
    </div>
  );
}

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="surface-card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left
                   hover:bg-muted transition-colors"
      >
        <span className="text-sm sm:text-base font-semibold text-foreground">
          {q}
        </span>
        <span
          className={`ml-2 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full
                      bg-warm/15 text-warm
                      transition-transform ${open ? "rotate-45" : ""}`}
          aria-hidden
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </span>
      </button>
      {open && (
        <div className="px-5 pb-4 text-sm text-muted-foreground leading-relaxed">
          {a}
        </div>
      )}
    </div>
  );
}

/** Render markdown-style **bold** segments with the warm accent colour. */
function renderBold(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**")
      ? (
        <strong key={i} className="text-warm font-bold">
          {part.slice(2, -2)}
        </strong>
      )
      : <span key={i}>{part}</span>
  );
}
