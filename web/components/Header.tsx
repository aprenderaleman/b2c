"use client";

import Link from "next/link";
import { LanguageToggle } from "./LanguageToggle";
import { ThemeToggle } from "./ThemeToggle";
import { RobotMark } from "./RobotMark";

export function Header() {
  return (
    <header className="w-full sticky top-0 z-40
                       bg-white/85 backdrop-blur-md
                       border-b border-border">
      <div className="container-x h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5" aria-label="Aprender-Aleman.de">
          <RobotMark size={36} />
          {/* Header bg stays white-ish in both modes (`bg-white/85`),
              so in dark mode we force navy text on the wordmark and
              the login button — `text-foreground` would resolve to
              white and disappear. The `.de` accent stays warm. */}
          <span className="font-semibold text-foreground dark:text-navy-900 hidden sm:inline">
            Aprender-Aleman<span className="text-warm">.de</span>
          </span>
        </Link>
        <div className="flex items-center gap-2">
          <Link
            href="/login"
            className="inline-flex items-center gap-1.5 rounded-lg
                       border border-border text-foreground
                       dark:text-navy-900 dark:border-navy-900/30
                       hover:border-foreground/40 dark:hover:border-navy-900/60
                       px-3.5 py-1.5 text-sm font-semibold transition-colors"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
              <path d="M10 17l5-5-5-5" />
              <path d="M15 12H3" />
            </svg>
            Iniciar sesión
          </Link>
          <ThemeToggle />
          <LanguageToggle />
        </div>
      </div>
    </header>
  );
}
