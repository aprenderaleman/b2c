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
            className="w-full rounded-3xl
                       bg-white dark:bg-slate-900
                       border border-slate-200 dark:border-slate-800
                       p-6 sm:p-8 shadow-sm"
          >
            <div className="flex flex-col items-center gap-3 text-center">
              <span className="inline-flex h-11 w-11 items-center justify-center
                               rounded-xl bg-brand-50 dark:bg-brand-500/15
                               text-brand-600 dark:text-brand-400"
                    aria-hidden>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" />
                  <line x1="16" y1="2"  x2="16" y2="6" />
                  <line x1="8"  y1="2"  x2="8"  y2="6" />
                  <line x1="3"  y1="10" x2="21" y2="10" />
                </svg>
              </span>

              <h2 className="text-lg sm:text-xl font-bold tracking-tight
                             text-slate-900 dark:text-slate-50">
                {t.confirmation.bookCtaTitle}
              </h2>
              <p className="max-w-md text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                {t.confirmation.bookCtaBody}
              </p>

              <a
                href={CALENDLY_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-primary mt-2"
              >
                {t.confirmation.bookCtaButton}
              </a>
              <span className="text-xs text-slate-500 dark:text-slate-400">
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
