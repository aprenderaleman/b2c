"use client";

import { useLang } from "@/lib/lang-context";

export function LanguageToggle() {
  const { lang, toggleLang } = useLang();
  return (
    <button
      type="button"
      onClick={toggleLang}
      className="rounded-full border border-slate-200 bg-white px-3 py-1.5
                 text-sm font-medium text-slate-700 transition-all
                 hover:border-brand-400 hover:text-brand-600
                 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
      aria-label="Toggle language"
    >
      {lang === "es" ? "🇩🇪 DE" : "🇪🇸 ES"}
    </button>
  );
}
