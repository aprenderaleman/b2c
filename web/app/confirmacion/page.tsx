"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Header } from "@/components/Header";
import { WhatsAppFloat } from "@/components/WhatsAppFloat";
import { useLang } from "@/lib/lang-context";
import { interpolate } from "@/lib/i18n";

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
      <main className="mx-auto max-w-2xl px-5 sm:px-6 pt-14 pb-24 text-center">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="flex flex-col items-center gap-6"
        >
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
          <p className="max-w-xl text-lg text-slate-600 dark:text-slate-300">
            {t.confirmation.body}
          </p>
          <div className="mt-4 rounded-3xl border border-brand-200 dark:border-brand-500/30
                          bg-brand-50/70 dark:bg-brand-500/10
                          px-6 py-5 max-w-xl">
            <p className="text-slate-700 dark:text-slate-200">{t.confirmation.schuleHint}</p>
            <a
              href="https://schule.aprender-aleman.de"
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary text-base mt-4"
            >
              {t.confirmation.schuleCta}
            </a>
          </div>
        </motion.div>
      </main>
      <WhatsAppFloat />
    </>
  );
}
