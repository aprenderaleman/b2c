"use client";

import { LanguageToggle } from "./LanguageToggle";
import { BrandLogo } from "./BrandLogo";

/**
 * Public-site header — minimalist on purpose.
 *
 * Solo tres elementos: el logo unificado (BrandLogo), el toggle de
 * idioma. Sin login link, sin theme toggle, sin CTAs extra — el landing
 * entero ES un CTA grande (el funnel inline) y el header se queda fuera.
 *
 * Estudiantes llegan a /login por URL directa; staff por /admin.
 */
export function Header() {
  return (
    <header className="w-full sticky top-0 z-40
                       bg-white/85 backdrop-blur-md
                       border-b border-border">
      <div className="container-x h-16 flex items-center justify-between">
        <BrandLogo size="md" />
        <LanguageToggle />
      </div>
    </header>
  );
}
