"use client";

import Link from "next/link";
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
        <section className="relative mx-auto max-w-5xl px-5 sm:px-6 pt-16 sm:pt-24 pb-14 sm:pb-20 text-center">
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
              <span className="bg-gradient-to-br from-slate-900 via-slate-800 to-brand-600
                               dark:from-slate-50 dark:via-brand-200 dark:to-brand-500
                               bg-clip-text text-transparent">
                {t.home.title}
              </span>
            </h1>

            <p className="max-w-2xl text-lg sm:text-xl md:text-2xl
                          font-semibold
                          text-slate-700 dark:text-slate-200
                          leading-relaxed sm:leading-snug">
              {renderBold(t.home.subtitle)}
            </p>

            <div className="mt-2 flex flex-col items-center gap-3 w-full sm:w-auto">
              <Link href="/funnel" className="btn-primary w-full sm:w-auto animate-pulse-glow">
                {t.home.cta}
                <span aria-hidden="true" className="ml-1">→</span>
              </Link>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {t.home.ctaHint}
              </span>
            </div>

            {/* Trust badges under CTA */}
            <div className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2
                            text-sm text-slate-600 dark:text-slate-400">
              <TrustBadge label={t.home.trust1} />
              <Dot />
              <TrustBadge label={t.home.trust2} />
              <Dot />
              <TrustBadge label={t.home.trust3} />
            </div>
          </motion.div>
        </section>

        {/* ────────── ADVANTAGES ────────── */}
        <section className="relative mx-auto max-w-6xl px-5 sm:px-6 pb-14">
          <div className="grid gap-4 sm:gap-5 sm:grid-cols-3">
            <Advantage
              emoji="🇩🇪"
              title={t.home.advantage1Title}
              body={t.home.advantage1Body}
              delay={0.1}
            />
            <Advantage
              emoji="🤖"
              title={t.home.advantage2Title}
              body={t.home.advantage2Body}
              delay={0.18}
              highlight
            />
            <Advantage
              emoji="🎯"
              title={t.home.advantage3Title}
              body={t.home.advantage3Body}
              delay={0.26}
            />
          </div>
        </section>

        {/* ────────── EXAM PREP — the star section ────────── */}
        <section className="relative mx-auto max-w-5xl px-5 sm:px-6 py-14 sm:py-20">
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.5 }}
            className="relative rounded-3xl overflow-hidden
                       bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900
                       dark:from-slate-800 dark:via-slate-900 dark:to-slate-950
                       p-6 sm:p-10 text-white"
          >
            {/* Warm glow behind */}
            <div className="pointer-events-none absolute -top-20 -right-20 h-60 w-60
                            rounded-full bg-brand-500/30 blur-3xl"/>
            <div className="pointer-events-none absolute -bottom-24 -left-16 h-60 w-60
                            rounded-full bg-brand-600/20 blur-3xl"/>

            <div className="relative">
              <span className="inline-flex items-center gap-1.5 rounded-full
                               bg-white/10 ring-1 ring-white/15
                               text-brand-200 text-xs font-semibold uppercase tracking-wider
                               px-3 py-1">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <path d="M12 2l2.4 7.4H22l-6 4.6 2.3 7.4L12 17l-6.3 4.4L8 14 2 9.4h7.6z"/>
                </svg>
                OFICIAL
              </span>
              <h2 className="mt-4 text-2xl sm:text-4xl font-bold tracking-tight max-w-2xl">
                {t.home.examsTitle}
              </h2>
              <p className="mt-3 text-slate-300 max-w-2xl text-sm sm:text-base">
                {t.home.examsSubtitle}
              </p>

              <div className="mt-7 grid gap-4 sm:grid-cols-2">
                <ExamCard
                  tag="Goethe-Institut"
                  title={t.home.examGoetheTitle}
                  body={t.home.examGoetheBody}
                />
                <ExamCard
                  tag="telc gGmbH"
                  title={t.home.examTelcTitle}
                  body={t.home.examTelcBody}
                />
              </div>

              <div className="mt-7">
                <Link
                  href="/funnel"
                  className="inline-flex items-center gap-2 rounded-2xl
                             bg-white text-slate-900 px-6 py-3.5 text-sm font-bold
                             hover:bg-brand-50 transition-colors
                             focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/30"
                >
                  {t.home.examsCTA}
                </Link>
              </div>
            </div>
          </motion.div>
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

function BackgroundBlobs() {
  return (
    <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <div className="absolute -top-24 left-1/2 -translate-x-1/2 w-[90%] max-w-[900px] h-[500px]
                      rounded-full
                      bg-[radial-gradient(closest-side,rgba(251,146,60,0.35),transparent)]
                      dark:bg-[radial-gradient(closest-side,rgba(251,146,60,0.25),transparent)]
                      blur-2xl"/>
      <div className="absolute top-[40%] -right-20 w-[300px] h-[300px] rounded-full
                      bg-[radial-gradient(closest-side,rgba(249,115,22,0.22),transparent)]
                      dark:bg-[radial-gradient(closest-side,rgba(249,115,22,0.15),transparent)]
                      blur-3xl"/>
    </div>
  );
}

function TrustBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
           className="text-brand-500" aria-hidden>
        <polyline points="20 6 9 17 4 12" />
      </svg>
      <span className="font-medium">{label}</span>
    </span>
  );
}

function Dot() {
  return <span className="h-1 w-1 rounded-full bg-slate-300 dark:bg-slate-600 hidden sm:block" aria-hidden />;
}

function Advantage({
  emoji, title, body, delay, highlight,
}: {
  emoji: string; title: string; body: string; delay: number; highlight?: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay }}
      className={`surface-card p-5 sm:p-6 transition-all
                  hover:-translate-y-0.5 hover:shadow-brand
                  ${highlight ? "ring-1 ring-brand-500/30 bg-gradient-to-br from-white to-brand-50 dark:from-slate-800/60 dark:to-brand-500/5" : ""}`}
    >
      <div className={`inline-flex h-11 w-11 items-center justify-center rounded-xl text-2xl
                       ${highlight
                          ? "bg-gradient-to-br from-brand-400 to-brand-600 shadow-brand"
                          : "bg-brand-50 dark:bg-slate-700/50"}`}
           aria-hidden>
        {emoji}
      </div>
      <h3 className="mt-3 text-lg font-bold text-slate-900 dark:text-slate-50">{title}</h3>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{body}</p>
    </motion.div>
  );
}

function ExamCard({ tag, title, body }: { tag: string; title: string; body: string }) {
  return (
    <div className="rounded-2xl bg-white/5 ring-1 ring-white/10 p-5 backdrop-blur-sm">
      <div className="text-[11px] uppercase tracking-widest text-brand-200 font-semibold">
        {tag}
      </div>
      <div className="mt-1 text-xl font-bold">{title}</div>
      <p className="mt-2 text-sm text-slate-300 leading-relaxed">{body}</p>
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
