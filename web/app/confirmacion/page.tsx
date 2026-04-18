"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Header } from "@/components/Header";
import { WhatsAppFloat } from "@/components/WhatsAppFloat";
import { useLang } from "@/lib/lang-context";
import { interpolate } from "@/lib/i18n";

const CALENDLY_URL = "https://calendly.com/aprenderaleman2026/sesion-de-prueba-de-aleman";

export default function ConfirmationPage() {
  const { t } = useLang();
  const [name, setName] = useState("");

  useEffect(() => {
    const n = sessionStorage.getItem("aa_lead_name") ?? "";
    setName(n);
    sessionStorage.removeItem("aa_lead_name");
  }, []);

  return (
    <>
      <Header />
      <main className="mx-auto max-w-2xl px-5 sm:px-6 pt-14 pb-24">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="flex flex-col items-center gap-6 text-center"
        >
          {/* Success icon */}
          <div className="h-20 w-20 rounded-full
                          bg-gradient-to-br from-brand-400 to-brand-600
                          shadow-brand-lg
                          flex items-center justify-center text-4xl">
            🎉
          </div>

          <h1 className="text-3xl sm:text-4xl font-extrabold
                         text-slate-900 dark:text-slate-50">
            {interpolate(t.confirmation.title, { name: name.split(/\s+/)[0] || "" })}
          </h1>

          <p className="max-w-xl text-base sm:text-lg text-slate-600 dark:text-slate-300 leading-relaxed">
            {t.confirmation.body}
          </p>

          {/* ────────── PRIMARY CTA — self-service booking ────────── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.15 }}
            className="relative w-full overflow-hidden rounded-3xl
                       bg-gradient-to-br from-brand-500 to-brand-600
                       p-6 sm:p-8 text-white shadow-brand-lg"
          >
            {/* Decorative glows */}
            <div className="pointer-events-none absolute -top-16 -left-16 h-44 w-44
                            rounded-full bg-white/10 blur-3xl"/>
            <div className="pointer-events-none absolute -bottom-16 -right-16 h-44 w-44
                            rounded-full bg-white/10 blur-3xl"/>

            <div className="relative flex flex-col items-center gap-3 text-center">
              <span className="inline-flex items-center gap-2 rounded-full
                               bg-white/15 ring-1 ring-white/20
                               text-white/90 text-[11px] font-semibold uppercase tracking-wider
                               px-3 py-1">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <path d="M19 3h-1V1h-2v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19a2 2 0 002 2h14a2 2 0 002-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11zM7 10h5v5H7z"/>
                </svg>
                {t.confirmation.bookCtaBadge}
              </span>

              <h2 className="text-xl sm:text-2xl font-bold tracking-tight">
                {t.confirmation.bookCtaTitle}
              </h2>
              <p className="text-white/90 max-w-md text-sm sm:text-base leading-relaxed">
                {t.confirmation.bookCtaBody}
              </p>

              <a
                href={CALENDLY_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-flex items-center gap-2 rounded-2xl
                           bg-white text-brand-600 px-7 py-4 text-base font-bold
                           hover:bg-brand-50 transition-colors
                           focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/40"
              >
                {t.confirmation.bookCtaButton}
              </a>
              <span className="text-xs text-white/80">
                {t.confirmation.bookCtaHint}
              </span>
            </div>
          </motion.div>

          {/* ────────── SECONDARY — SCHULE while they wait ────────── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.25 }}
            className="w-full rounded-3xl border border-slate-200 dark:border-slate-700
                       bg-white/70 dark:bg-slate-900/50 backdrop-blur-sm
                       px-6 py-5 flex flex-col sm:flex-row items-center justify-between
                       gap-4 text-left"
          >
            <div className="flex items-start gap-3 flex-1 min-w-0">
              <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center
                               rounded-xl bg-brand-50 dark:bg-brand-500/15 text-xl"
                    aria-hidden>
                🎓
              </span>
              <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed">
                {t.confirmation.schuleHint}
              </p>
            </div>
            <a
              href="https://schule.aprender-aleman.de"
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 inline-flex items-center gap-1.5 rounded-xl
                         border border-brand-200 dark:border-brand-500/40
                         bg-brand-50/60 dark:bg-brand-500/10
                         px-4 py-2 text-sm font-semibold
                         text-brand-700 dark:text-brand-300
                         hover:bg-brand-100 dark:hover:bg-brand-500/20 transition-colors"
            >
              {t.confirmation.schuleCta}
            </a>
          </motion.div>
        </motion.div>
      </main>
      <WhatsAppFloat />
    </>
  );
}
