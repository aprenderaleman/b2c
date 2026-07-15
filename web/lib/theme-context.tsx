"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

type Theme = "light" | "dark";
const STORAGE_KEY = "aa_theme_v2";

type Ctx = {
  theme: Theme;
  toggle: () => void;
  setTheme: (t: Theme) => void;
};

const ThemeContext = createContext<Ctx | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Start with the theme the inline <script> in layout already wrote.
  // On the server we default to dark to match the init script.
  const [theme, setThemeState] = useState<Theme>("dark");

  useEffect(() => {
    // Dark mode is the default. Light mode requires explicit user opt-in
    // (persisted in localStorage).
    const stored = (typeof window !== "undefined"
      ? (localStorage.getItem(STORAGE_KEY) as Theme | null)
      : null);
    const resolved: Theme = stored === "light" ? "light" : "dark";
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
 * Synchronous script that runs BEFORE React hydrates. Dark mode is the
 * default; only an explicit 'light' value in localStorage removes it.
 * Embed inside <head>.
 */
export const THEME_INIT_SCRIPT = `
try {
  if (localStorage.getItem('${STORAGE_KEY}') !== 'light') {
    document.documentElement.classList.add('dark');
  }
} catch (e) {
  document.documentElement.classList.add('dark');
}
`;
