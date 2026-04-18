"use client";

import Image from "next/image";
import Link from "next/link";
import { LanguageToggle } from "./LanguageToggle";
import { ThemeToggle } from "./ThemeToggle";

export function Header() {
  return (
    <header className="w-full sticky top-0 z-40
                       bg-white/80 dark:bg-slate-900/70
                       backdrop-blur-md
                       border-b border-slate-100 dark:border-slate-800">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <Image src="/logo.png" alt="Aprender-Aleman.de" width={36} height={36} priority />
          <span className="font-bold text-slate-800 dark:text-slate-100 hidden sm:inline">
            Aprender-Aleman<span className="text-brand-500">.de</span>
          </span>
        </Link>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <LanguageToggle />
        </div>
      </div>
    </header>
  );
}
