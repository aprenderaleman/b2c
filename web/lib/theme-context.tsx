"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

type Theme = "light" | "dark";
const STORAGE_KEY = "aa_theme";

type Ctx = {
  theme: Theme;
  toggle: () => void;
  setTheme: (t: Theme) => void;
};

const ThemeContext = createContext<Ctx | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Start with the theme the inline <script> in layout already wrote.
  // On the server we just default to light to avoid hydration warnings.
  const [theme, setThemeState] = useState<Theme>("light");

  useEffect(() => {
    // Light mode is the default. Dark mode requires explicit user opt-in
    // (persisted in localStorage). We deliberately ignore `prefers-color-scheme`
    // to keep the marketing surface consistent for the majority of visitors.
    const stored = (typeof window !== "undefined"
      ? (localStorage.getItem(STORAGE_KEY) as Theme | null)
      : null);
    const resolved: Theme = stored === "dark" ? "dark" : "light";
    setThemeState(resolved);
    document.documentElement.classList.toggle("dark", resolved === "dark");
  }, []);

  const setTheme = (t: Theme) => {
    setThemeState(t);
    document.documentElement.classList.toggle("dark", t === "dark");
    if (typeof window !== "undefined") localStorage.setItem(STORAGE_KEY, t);
  };
  const toggle = () => setTheme(theme === "dark" ? "light" : "dark");

  return (
    <ThemeContext.Provider value={{ theme, toggle, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): Ctx {
  const c = useContext(ThemeContext);
  if (!c) throw new Error("useTheme must be used inside <ThemeProvider>");
  return c;
}

/**
 * Synchronous script that runs BEFORE React hydrates, so users with a saved
 * dark preference don't see a flash of white. Light mode is the default;
 * only an explicit 'dark' value in localStorage opts into dark mode.
 * Embed inside <head>.
 */
export const THEME_INIT_SCRIPT = `
try {
  if (localStorage.getItem('${STORAGE_KEY}') === 'dark') {
    document.documentElement.classList.add('dark');
  }
} catch (e) {}
`;
