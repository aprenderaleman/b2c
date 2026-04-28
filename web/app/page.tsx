"use client";

import Link from "next/link";
import { useState } from "react";
import { motion } from "framer-motion";
import { Header } from "@/components/Header";
import { WhatsAppFloat } from "@/components/WhatsAppFloat";
import { HomeFunnelMobile } from "@/components/home/HomeFunnelMobile";
import { DesktopHero }     from "@/components/home/DesktopHero";
import { TrustStrip }      from "@/components/home/TrustStrip";
import { HowItWorks }      from "@/components/home/HowItWorks";
import { StatsBand }       from "@/components/home/StatsBand";
import { TeachersGrid }    from "@/components/home/TeachersGrid";
import { Testimonials }    from "@/components/home/Testimonials";
import { Comparativa }     from "@/components/home/Comparativa";
import { FinalCta }        from "@/components/home/FinalCta";
import { useLang } from "@/lib/lang-context";
import { interpolate } from "@/lib/i18n";

/**
 * Aprender-Aleman.de — public landing.
 *
 * Two distinct compositions, side by side, gated by Tailwind
 * breakpoints (no JS-driven UA sniff):
 *
 *   md:hidden           Mobile-native flow: hero copy + inline funnel
 *                       (HomeFunnelMobile) + FAQ + footer.
 *
 *   hidden md:block     Desktop CRO flow: split hero with sticky
 *                       calendar (DesktopHero) → trust strip → how it
 *                       works → stats → profes → testimonios →
 *                       comparativa → FAQ → final CTA → footer.
 *
 * Both flows POST to the same /api/public/book-trial endpoint and
 * redirect to /confirmacion on success — i.e. the LMS, the agents
 * pipeline, the admin views and the trial-token machinery are
 * unaware of which composition the lead came from.
 */
export default function HomePage() {
  const { t } = useLang();

  return (
    <>
      <Header />
      <main id="top">

        {/* ══════════════ MOBILE (md:hidden) ══════════════════════ */}
        {/* Hero copy + inline funnel + FAQ + footer. No collapse on
            step change anymore — the new mobile shell at /agendar
            owns the rest of the funnel. */}
        <motion.section
          key="hero-mobile"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
          className="md:hidden bg-navy-900 text-white"
        >
          <div className="mx-auto max-w-5xl px-5 pt-16 pb-14 text-center">
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

              <h1 className="font-bold tracking-tight text-white text-4xl leading-[1.05] max-w-3xl">
                {renderBold(t.home.title)}
              </h1>

              <p className="max-w-2xl text-lg font-medium text-white/75 leading-relaxed">
                {renderBold(t.home.subtitle)}
              </p>

              <RatingBadge />
            </div>
          </div>
        </motion.section>

        <HomeFunnelMobile />

        {/* ══════════════ DESKTOP (hidden md:block) ════════════════ */}
        <DesktopHero />
        <TrustStrip />
        <HowItWorks />
        <StatsBand />
        <TeachersGrid />
        <Testimonials />
        <Comparativa />

        {/* ══════════════ FAQ — both viewports ════════════════════ */}
        <section className="bg-white dark:bg-slate-950">
          <div className="mx-auto max-w-3xl px-5 sm:px-6 py-14 sm:py-20">
            <SectionHeader title={t.home.faqTitle} />
            <div className="mt-8 flex flex-col gap-3">
              <FaqItem q={t.home.faq1Q} a={t.home.faq1A} />
              <FaqItem q={t.home.faq2Q} a={t.home.faq2A} />
              <FaqItem q={t.home.faq3Q} a={t.home.faq3A} />
              <FaqItem q={t.home.faq4Q} a={t.home.faq4A} />
              <FaqItem q={t.home.faq5Q} a={t.home.faq5A} />
              <FaqItem q={t.home.faq6Q} a={t.home.faq6A} />
            </div>
          </div>
        </section>

        {/* Final CTA — desktop only; mobile already has the floating
            glass CTA from HomeFunnelMobile. */}
        <FinalCta />

        {/* ══════════════ FOOTER ══════════════════════════════════ */}
        <footer className="bg-navy-900 text-white border-t border-navy-700">
          <div className="mx-auto max-w-6xl px-5 sm:px-6 py-8 flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-6 text-sm text-white/70">
            <span>{interpolate(t.home.footer, { year: new Date().getFullYear() })}</span>
            <span className="hidden sm:inline">·</span>
            <Link href="/privacy" className="hover:text-warm underline-offset-4 hover:underline transition-colors">
              {t.step4.gdprLink}
            </Link>
          </div>
        </footer>
      </main>

      {/* WhatsApp corner button — desktop only; mobile uses the
          segmented control inside HomeFunnelMobile. */}
      <div className="hidden md:block">
        <WhatsAppFloat />
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────
// Shared building blocks
// ─────────────────────────────────────────────────────────

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
