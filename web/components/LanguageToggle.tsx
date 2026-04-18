"use client";

import { useLang } from "@/lib/lang-context";

export function LanguageToggle() {
  const { lang, toggleLang } = useLang();
  return (
    <button
      type="button"
      onClick={toggleLang}
      className="inline-flex items-center gap-1.5 h-10 px-3
                 rounded-full border
                 border-slate-200 dark:border-slate-700
                 bg-white dark:bg-slate-800
                 text-sm font-medium text-slate-700 dark:text-slate-200
                 transition-all
                 hover:border-brand-400 hover:text-brand-600
                 dark:hover:text-brand-400 dark:hover:border-brand-500
                 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
      aria-label="Toggle language"
    >
      {lang === "es" ? "🇩🇪 DE" : "🇪🇸 ES"}
    </button>
  );
}
