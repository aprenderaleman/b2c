"use client";

import Image from "next/image";
import Link from "next/link";
import { LanguageToggle } from "./LanguageToggle";

export function Header() {
  return (
    <header className="w-full border-b border-slate-100 bg-white/80 backdrop-blur sticky top-0 z-40">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <Image
            src="/logo.png"
            alt="Aprender-Aleman.de"
            width={40}
            height={40}
            priority
          />
          <span className="font-bold text-slate-800 hidden sm:inline">
            Aprender-Aleman<span className="text-brand-500">.de</span>
          </span>
        </Link>
        <LanguageToggle />
      </div>
    </header>
  );
}
