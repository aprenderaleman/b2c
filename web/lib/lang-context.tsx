"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { translations, detectBrowserLang, type Lang, type Translations } from "./i18n";

type Ctx = {
  lang: Lang;
  t: Translations;
  setLang: (l: Lang) => void;
  toggleLang: () => void;
};

const LangContext = createContext<Ctx | null>(null);

const STORAGE_KEY = "aa_lang";

export function LangProvider({ children, initial }: { children: ReactNode; initial?: Lang }) {
  const [lang, setLangState] = useState<Lang>(initial ?? "es");

  // On mount, pick up saved pref or detect browser.
  useEffect(() => {
    const saved = (typeof window !== "undefined"
      ? (localStorage.getItem(STORAGE_KEY) as Lang | null)
      : null);
    if (saved === "es" || saved === "de") {
      setLangState(saved);
    } else {
      setLangState(detectBrowserLang());
    }
  }, []);

  const setLang = (l: Lang) => {
    setLangState(l);
    if (typeof window !== "undefined") localStorage.setItem(STORAGE_KEY, l);
    if (typeof document !== "undefined") document.documentElement.lang = l;
  };

  const toggleLang = () => setLang(lang === "es" ? "de" : "es");

  const value: Ctx = { lang, t: translations[lang], setLang, toggleLang };
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useLang(): Ctx {
  const c = useContext(LangContext);
  if (!c) throw new Error("useLang must be used inside <LangProvider>");
  return c;
}
