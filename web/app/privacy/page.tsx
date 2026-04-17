"use client";

import { Header } from "@/components/Header";
import { WhatsAppFloat } from "@/components/WhatsAppFloat";
import { useLang } from "@/lib/lang-context";

export default function PrivacyPage() {
  const { t, lang } = useLang();
  const today = new Date().toLocaleDateString(lang === "de" ? "de-DE" : "es-ES");
  return (
    <>
      <Header />
      <main className="mx-auto max-w-3xl px-4 sm:px-6 py-12 prose prose-slate">
        <h1 className="text-3xl font-bold text-slate-900">{t.privacy.title}</h1>
        <p className="text-sm text-slate-500">{t.privacy.lastUpdated}: {today}</p>
        <p className="mt-6 text-slate-700">{t.privacy.placeholder}</p>
      </main>
      <WhatsAppFloat />
    </>
  );
}
