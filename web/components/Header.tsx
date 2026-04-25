"use client";

import Link from "next/link";
import { LanguageToggle } from "./LanguageToggle";
import { ThemeToggle } from "./ThemeToggle";
import { RobotMark } from "./RobotMark";

export function Header() {
  return (
    <header className="w-full sticky top-0 z-40
                       bg-card/80 backdrop-blur-md
                       border-b border-border">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 md:px-8 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5" aria-label="Aprender-Aleman.de">
          <RobotMark size={38} className="dark:drop-shadow-[0_0_8px_rgba(244,162,97,0.35)]" />
          <span className="font-semibold text-foreground hidden sm:inline">
            Aprender-Aleman<span className="text-warm">.de</span>
          </span>
        </Link>
        <div className="flex items-center gap-2">
          <Link
            href="/login"
            className="inline-flex items-center gap-1.5 rounded-full
                       border border-warm/40 bg-warm/10 text-warm
                       hover:bg-warm/20
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
