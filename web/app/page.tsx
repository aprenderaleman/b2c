"use client";

import Image from "next/image";
import Link from "next/link";
import { motion } from "framer-motion";
import { Header } from "@/components/Header";
import { WhatsAppFloat } from "@/components/WhatsAppFloat";
import { useLang } from "@/lib/lang-context";
import { interpolate } from "@/lib/i18n";

export default function HomePage() {
  const { t } = useLang();
  const advantages = [
    { title: t.home.advantage1Title, body: t.home.advantage1Body, emoji: "🇩🇪" },
    { title: t.home.advantage2Title, body: t.home.advantage2Body, emoji: "🤖" },
    { title: t.home.advantage3Title, body: t.home.advantage3Body, emoji: "🎯" },
  ];

  return (
    <>
      <Header />
      <main className="relative">
        {/* Hero */}
        <section className="mx-auto max-w-6xl px-4 sm:px-6 pt-14 pb-10 text-center">
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: "easeOut" }}
            className="flex flex-col items-center gap-5"
          >
            <Image
              src="/logo.png"
              alt="Hans — profesor IA"
              width={140}
              height={140}
              priority
              className="drop-shadow-xl"
            />
            <span className="inline-block rounded-full bg-brand-50 px-4 py-1.5 text-sm font-medium text-brand-700">
              {t.home.tagline}
            </span>
            <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-slate-900 max-w-3xl">
              {t.home.title}
            </h1>
            <p className="max-w-2xl text-lg text-slate-600">
              {t.home.subtitle}
            </p>
            <Link href="/funnel" className="btn-primary text-base mt-3">
              {t.home.cta}
              <span aria-hidden="true">→</span>
            </Link>
          </motion.div>
        </section>

        {/* Advantages */}
        <section className="mx-auto max-w-6xl px-4 sm:px-6 pb-20">
          <div className="grid gap-5 sm:grid-cols-3">
            {advantages.map((a, i) => (
              <motion.div
                key={a.title}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, delay: 0.1 + i * 0.08 }}
                className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm
                           hover:shadow-brand hover:border-brand-200 transition-all"
              >
                <div className="text-3xl">{a.emoji}</div>
                <h3 className="mt-3 text-lg font-bold text-slate-900">{a.title}</h3>
                <p className="mt-1 text-slate-600">{a.body}</p>
              </motion.div>
            ))}
          </div>
        </section>

        <footer className="border-t border-slate-100 py-8 text-center text-sm text-slate-500">
          {interpolate(t.home.footer, { year: new Date().getFullYear() })}
          {" · "}
          <Link href="/privacy" className="hover:text-brand-600">
            {t.step4.gdprLink}
          </Link>
        </footer>
      </main>
      <WhatsAppFloat />
    </>
  );
}
