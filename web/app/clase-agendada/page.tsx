"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Header } from "@/components/Header";
import { WhatsAppFloat } from "@/components/WhatsAppFloat";
import { useLang } from "@/lib/lang-context";

/**
 * Post-Calendly confirmation page.
 *
 * Calendly should redirect here after a successful booking. The URL is:
 *   https://aprender-aleman.de/clase-agendada
 *
 * No user data is required on this page — the booking webhook already fired
 * server-side. This is purely a warm, professional "see you soon" surface
 * that also pushes the user toward SCHULE while they wait.
 */
export default function ClaseAgendadaPage() {
  const { t } = useLang();

  return (
    <>
      <Header />
      <main className="relative overflow-hidden">
        <BackgroundBlobs />

        {/* ────────── HERO ────────── */}
        <section className="relative mx-auto max-w-3xl px-5 sm:px-6 pt-14 sm:pt-20 pb-10 text-center">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: "easeOut" }}
            className="flex flex-col items-center gap-6"
          >
            <CheckIcon />

            <span className="inline-flex items-center gap-2 rounded-full
                             bg-emerald-50 dark:bg-emerald-500/10
                             text-emerald-700 dark:text-emerald-300
                             px-4 py-1.5 text-sm font-semibold
                             ring-1 ring-emerald-500/20 dark:ring-emerald-500/30">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"/>
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"/>
              </span>
              {t.booked.badge}
            </span>

            <h1 className="font-extrabold tracking-tight text-slate-900 dark:text-slate-50
                           text-3xl sm:text-5xl leading-[1.05] max-w-2xl">
              <span className="bg-gradient-to-br from-slate-900 via-slate-800 to-brand-600
                               dark:from-slate-50 dark:via-brand-200 dark:to-brand-500
                               bg-clip-text text-transparent">
                {t.booked.title}
              </span>
            </h1>

            <p className="max-w-xl text-base sm:text-lg
                          text-slate-700 dark:text-slate-200
                          leading-relaxed">
              {t.booked.body}
            </p>
          </motion.div>
        </section>

        {/* ────────── NEXT STEPS ────────── */}
        <section className="relative mx-auto max-w-5xl px-5 sm:px-6 pb-10">
          <div className="grid gap-4 sm:gap-5 sm:grid-cols-3">
            <NextStep
              emoji="📧"
              title={t.booked.card1Title}
              body={t.booked.card1Body}
              delay={0.05}
            />
            <NextStep
              emoji="💬"
              title={t.booked.card2Title}
              body={t.booked.card2Body}
              delay={0.15}
              highlight
            />
            <NextStep
              emoji="🎓"
              title={t.booked.card3Title}
              body={t.booked.card3Body}
              delay={0.25}
            />
          </div>
        </section>

        {/* ────────── SCHULE CTA ────────── */}
        <section className="relative mx-auto max-w-4xl px-5 sm:px-6 py-10 sm:py-14">
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.5 }}
            className="relative overflow-hidden rounded-3xl
                       bg-gradient-to-br from-brand-500 to-brand-600
                       p-8 sm:p-10 text-center text-white shadow-brand"
          >
            <div className="pointer-events-none absolute -top-16 -left-16 h-48 w-48
                            rounded-full bg-white/10 blur-3xl"/>
            <div className="pointer-events-none absolute -bottom-16 -right-16 h-48 w-48
                            rounded-full bg-white/10 blur-3xl"/>
            <div className="relative flex flex-col items-center gap-4">
              <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl
                              bg-white/15 ring-1 ring-white/20 text-3xl">
                🎓
              </div>
              <p className="text-white/90 max-w-lg text-sm sm:text-base">
                {t.booked.card3Body}
              </p>
              <a
                href="https://schule.aprender-aleman.de"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-2xl
                           bg-white text-brand-600 px-6 py-3.5 text-sm font-bold
                           hover:bg-brand-50 transition-colors
                           focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/40"
              >
                {t.booked.schuleCta}
              </a>
            </div>
          </motion.div>
        </section>

        {/* ────────── FOOTER NOTE ────────── */}
        <section className="relative mx-auto max-w-3xl px-5 sm:px-6 pb-16 sm:pb-24 text-center">
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
            {t.booked.footNote}
          </p>
          <div className="mt-6">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-sm font-medium
                         text-slate-600 dark:text-slate-300
                         hover:text-brand-600 dark:hover:text-brand-400 transition-colors"
            >
              <span aria-hidden>←</span>
              {t.booked.homeCta}
            </Link>
          </div>
        </section>
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
                      bg-[radial-gradient(closest-side,rgba(16,185,129,0.22),transparent)]
                      dark:bg-[radial-gradient(closest-side,rgba(16,185,129,0.15),transparent)]
                      blur-3xl"/>
    </div>
  );
}

function CheckIcon() {
  return (
    <motion.div
      initial={{ scale: 0, rotate: -20 }}
      animate={{ scale: 1, rotate: 0 }}
      transition={{ duration: 0.55, type: "spring", bounce: 0.4 }}
      className="relative"
    >
      <div className="absolute inset-0 rounded-full bg-emerald-400/30 blur-2xl animate-pulse" aria-hidden />
      <div className="relative h-20 w-20 rounded-full
                      bg-gradient-to-br from-emerald-400 to-emerald-600
                      shadow-[0_20px_50px_-12px_rgba(16,185,129,0.5)]
                      flex items-center justify-center">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
             className="text-white" aria-hidden>
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>
    </motion.div>
  );
}

function NextStep({
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
      <h3 className="mt-3 text-base sm:text-lg font-bold text-slate-900 dark:text-slate-50">{title}</h3>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{body}</p>
    </motion.div>
  );
}
