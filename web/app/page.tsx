"use client";

import Link from "next/link";
import { useState } from "react";
import { motion } from "framer-motion";
import { Header } from "@/components/Header";
import { WhatsAppFloat } from "@/components/WhatsAppFloat";
import { useLang } from "@/lib/lang-context";
import { interpolate } from "@/lib/i18n";

export default function HomePage() {
  const { t } = useLang();

  return (
    <>
      <Header />
      <main className="relative overflow-hidden">
        {/* Decorative background blobs (behind everything) */}
        <BackgroundBlobs />

        {/* ────────── HERO ────────── */}
        <section className="relative mx-auto max-w-5xl px-5 sm:px-6 pt-16 sm:pt-24 pb-10 sm:pb-14 text-center">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: "easeOut" }}
            className="flex flex-col items-center gap-5"
          >
            <span className="inline-flex items-center gap-2 rounded-full
                             bg-brand-50 dark:bg-brand-500/10
                             text-brand-700 dark:text-brand-300
                             px-4 py-1.5 text-sm font-medium
                             ring-1 ring-brand-500/20 dark:ring-brand-500/30">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-400 opacity-75"/>
                <span className="relative inline-flex h-2 w-2 rounded-full bg-brand-500"/>
              </span>
              {t.home.tagline}
            </span>

            <h1 className="font-extrabold tracking-tight text-slate-900 dark:text-slate-50
                           text-5xl sm:text-6xl md:text-7xl leading-[1.02]
                           max-w-3xl">
              {renderBold(t.home.title)}
            </h1>

            <p className="max-w-2xl text-lg sm:text-xl md:text-2xl
                          font-semibold
                          text-slate-700 dark:text-slate-200
                          leading-relaxed sm:leading-snug">
              {renderBold(t.home.subtitle)}
            </p>

            <div className="mt-2 flex flex-col items-center gap-3 w-full sm:w-auto">
              <Link
                href="/funnel"
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2
                           rounded-2xl px-8 py-4 text-base font-bold text-white
                           bg-gradient-to-r from-emerald-500 to-emerald-600
                           hover:from-emerald-600 hover:to-emerald-700
                           shadow-lg shadow-emerald-500/30
                           ring-1 ring-emerald-400/40
                           transition-all hover:-translate-y-0.5
                           animate-pulse-glow
                           tracking-wide"
              >
                {t.home.cta}
                <span aria-hidden="true" className="ml-1">→</span>
              </Link>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {t.home.ctaHint}
              </span>
            </div>

            {/* Trust badges under CTA (title + body) */}
            <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6 w-full max-w-3xl">
              <TrustBadge title={t.home.trust1Title} body={t.home.trust1Body} />
              <TrustBadge title={t.home.trust2Title} body={t.home.trust2Body} />
              <TrustBadge title={t.home.trust3Title} body={t.home.trust3Body} />
            </div>
          </motion.div>
        </section>

        {/* ────────── FAQ ────────── */}
        <section className="relative mx-auto max-w-3xl px-5 sm:px-6 py-14 sm:py-20">
          <SectionHeader title={t.home.faqTitle} />
          <div className="mt-8 flex flex-col gap-3">
            <FaqItem q={t.home.faq1Q} a={t.home.faq1A} />
            <FaqItem q={t.home.faq2Q} a={t.home.faq2A} />
            <FaqItem q={t.home.faq3Q} a={t.home.faq3A} />
            <FaqItem q={t.home.faq4Q} a={t.home.faq4A} />
            <FaqItem q={t.home.faq5Q} a={t.home.faq5A} />
          </div>
        </section>

        {/* ────────── FOOTER ────────── */}
        <footer className="relative border-t border-slate-200 dark:border-slate-800
                           py-8 text-center text-sm text-slate-500 dark:text-slate-400">
          <div className="mx-auto max-w-6xl px-5 sm:px-6 flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-6">
            <span>{interpolate(t.home.footer, { year: new Date().getFullYear() })}</span>
            <span className="hidden sm:inline">·</span>
            <Link href="/privacy" className="hover:text-brand-600 dark:hover:text-brand-400 underline-offset-4 hover:underline">
              {t.step4.gdprLink}
            </Link>
          </div>
        </footer>
      </main>
      <WhatsAppFloat />
    </>
  );
}

// ─────────────────────────────────────────────────────────
// Building blocks
// ─────────────────────────────────────────────────────────

/**
 * Mesh-aurora hero backdrop.
 *
 * Five overlapping color blobs (brand-orange, coral, amber, peach,
 * deep orange) with strong blur and blend modes so they melt into
 * each other like northern lights. Each blob drifts on its own slow
 * keyframe (18-26s) so the composition is constantly shifting without
 * being distracting.
 *
 * Blend modes per scheme:
 *   - light: mix-blend-multiply  → blobs darken on overlap, warm "sunset"
 *   - dark:  mix-blend-screen    → blobs brighten on overlap, glowing
 *
 * A super-subtle SVG noise layer kills the "plastic gradient" look.
 *
 * All CSS, no images, no JS. Performance-safe (transform-only animations).
 */
function BackgroundBlobs() {
  const noiseSvg =
    "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 240 240'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>\")";
  return (
    <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      {/* Soft base wash so blobs have something to blend against */}
      <div className="absolute inset-0
                      bg-gradient-to-br from-orange-50/60 via-white to-amber-50/40
                      dark:from-slate-950 dark:via-slate-950 dark:to-slate-900" />

      {/* Brand orange — top-left of the title area */}
      <div className="absolute -top-32 left-[15%] w-[640px] h-[640px] rounded-full
                      bg-brand-500/45 dark:bg-brand-500/35
                      blur-[110px]
                      mix-blend-multiply dark:mix-blend-screen
                      animate-aurora-a will-change-transform" />

      {/* Coral / rose — top-right */}
      <div className="absolute -top-20 right-[5%] w-[520px] h-[520px] rounded-full
                      bg-rose-400/40 dark:bg-rose-500/30
                      blur-[110px]
                      mix-blend-multiply dark:mix-blend-screen
                      animate-aurora-b will-change-transform" />

      {/* Amber — mid-left */}
      <div className="absolute top-32 -left-28 w-[480px] h-[480px] rounded-full
                      bg-amber-400/40 dark:bg-amber-500/25
                      blur-[110px]
                      mix-blend-multiply dark:mix-blend-screen
                      animate-aurora-c will-change-transform" />

      {/* Peach — lower-center */}
      <div className="absolute top-[55%] left-[35%] w-[500px] h-[500px] rounded-full
                      bg-orange-300/45 dark:bg-orange-400/28
                      blur-[110px]
                      mix-blend-multiply dark:mix-blend-screen
                      animate-aurora-b will-change-transform"
           style={{ animationDelay: "-7s" }} />

      {/* Deep orange — lower-right */}
      <div className="absolute top-[60%] right-[8%] w-[440px] h-[440px] rounded-full
                      bg-orange-600/35 dark:bg-orange-600/25
                      blur-[110px]
                      mix-blend-multiply dark:mix-blend-screen
                      animate-aurora-a will-change-transform"
           style={{ animationDelay: "-9s" }} />

      {/* Noise: ~3% so the gradient doesn't read as plasticky */}
      <div aria-hidden
           className="absolute inset-0 opacity-[0.03] dark:opacity-[0.06] mix-blend-overlay"
           style={{ backgroundImage: noiseSvg, backgroundSize: "240px 240px" }} />
    </div>
  );
}

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="text-center">
      <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900 dark:text-slate-50">
        {title}
      </h2>
      {subtitle && (
        <p className="mt-2 text-sm sm:text-base text-slate-600 dark:text-slate-400">
          {subtitle}
        </p>
      )}
    </div>
  );
}

function TrustBadge({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex items-start gap-3 text-left">
      <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center
                       rounded-full bg-brand-50 dark:bg-brand-500/15
                       text-brand-600 dark:text-brand-400
                       ring-1 ring-brand-500/20">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
             aria-hidden>
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </span>
      <span className="flex flex-col">
        <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
          {title}
        </span>
        <span className="text-xs text-slate-500 dark:text-slate-400">
          {body}
        </span>
      </span>
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
                   hover:bg-brand-50/40 dark:hover:bg-slate-800/40 transition-colors"
      >
        <span className="text-sm sm:text-base font-semibold text-slate-900 dark:text-slate-100">
          {q}
        </span>
        <span
          className={`ml-2 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full
                      bg-brand-50 dark:bg-brand-500/15 text-brand-600 dark:text-brand-300
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
        <div className="px-5 pb-4 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
          {a}
        </div>
      )}
    </div>
  );
}

/** Render markdown-style **bold** segments with brand colour. */
function renderBold(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**")
      ? (
        <strong key={i} className="text-brand-600 dark:text-brand-400 font-extrabold">
          {part.slice(2, -2)}
        </strong>
      )
      : <span key={i}>{part}</span>
  );
}
