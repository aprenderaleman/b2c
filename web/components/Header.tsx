"use client";

import Link from "next/link";
import { LanguageToggle } from "./LanguageToggle";
import { RobotMark } from "./RobotMark";

/**
 * Public-site header — minimalist on purpose.
 *
 * Only three elements: the robot mark, the academy wordmark, and the
 * language toggle. No login link, no theme toggle, no extra CTAs —
 * the whole landing IS one big CTA (the inline funnel) so the header
 * stays out of the way.
 *
 * Existing students reach /login via direct URL; staff via /admin.
 */
export function Header() {
  return (
    <header className="w-full sticky top-0 z-40
                       bg-white/85 backdrop-blur-md
                       border-b border-border">
      <div className="container-x h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5" aria-label="Aprender-Aleman.de">
          <RobotMark size={36} />
          {/* Header bg stays white-ish in both modes (`bg-white/85`),
              so in dark mode we force navy text on the wordmark.
              The `.de` accent stays warm. */}
          <span className="font-semibold text-foreground dark:text-navy-900">
            Aprender-Aleman<span className="text-warm">.de</span>
          </span>
        </Link>
        <LanguageToggle />
      </div>
    </header>
  );
}
