"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { NavIcon } from "./NavIcon";
import type { NavItem } from "@/lib/nav-items";

/**
 * Fixed bottom tab bar (mobile, <lg). Shows 4 primary items + "Más"
 * which opens a bottom-sheet with the rest and a logout link.
 */
export function BottomNavMobile({
  primary,
  extras,
  logoutForm,
}: {
  primary:    NavItem[];
  extras:     NavItem[];
  logoutForm: React.ReactNode;     // a <form action={serverAction}><button>Cerrar sesión</button></form> from the shell
}) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

  const renderTab = (it: NavItem) => {
    const active = isActive(pathname, it.href);
    return (
      <Link
        key={it.href}
        href={it.href}
        className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium
          ${active
            ? "text-brand-600 dark:text-brand-400"
            : "text-slate-500 dark:text-slate-400"}`}
      >
        <NavIcon name={it.icon} className="h-5 w-5" />
        <span className="truncate max-w-[64px]">{it.label}</span>
      </Link>
    );
  };

  return (
    <>
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 border-t border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur pb-[env(safe-area-inset-bottom)]">
        <div className="flex items-stretch">
          {primary.map(renderTab)}
          {(extras.length > 0 || true) && (
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium text-slate-500 dark:text-slate-400"
            >
              <span className="h-5 w-5 inline-flex items-center justify-center">•••</span>
              <span>Más</span>
            </button>
          )}
        </div>
      </nav>

      {moreOpen && (
        <MoreSheet
          extras={extras}
          onClose={() => setMoreOpen(false)}
          logoutForm={logoutForm}
        />
      )}
    </>
  );
}

function MoreSheet({
  extras, onClose, logoutForm,
}: {
  extras:     NavItem[];
  onClose:    () => void;
  logoutForm: React.ReactNode;
}) {
  return (
    <div className="lg:hidden fixed inset-0 z-50" role="dialog" aria-modal>
      <button
        type="button"
        onClick={onClose}
        className="absolute inset-0 bg-black/50"
        aria-label="Cerrar"
      />
      <div className="absolute inset-x-0 bottom-0 rounded-t-3xl bg-white dark:bg-slate-900 p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] shadow-2xl">
        <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-slate-300 dark:bg-slate-700" />
        <div className="grid grid-cols-3 gap-2">
          {extras.map(it => (
            <Link
              key={it.href}
              href={it.href}
              onClick={onClose}
              className="flex flex-col items-center gap-1 rounded-2xl border border-slate-200 dark:border-slate-800 p-3 text-xs text-slate-700 dark:text-slate-200 hover:border-brand-400 transition-colors"
            >
              <NavIcon name={it.icon} className="h-6 w-6" />
              <span className="truncate">{it.label}</span>
            </Link>
          ))}
        </div>
        <div className="mt-4 [&_button]:w-full [&_button]:rounded-xl [&_button]:bg-slate-100 dark:[&_button]:bg-slate-800 [&_button]:py-3 [&_button]:text-sm [&_button]:font-medium [&_button]:text-slate-700 dark:[&_button]:text-slate-200 [&_button]:hover:bg-slate-200 dark:[&_button]:hover:bg-slate-700">
          {logoutForm}
        </div>
      </div>
    </div>
  );
}

function isActive(pathname: string, href: string): boolean {
  if (href === "/admin"      && pathname === "/admin")      return true;
  if (href === "/profesor"   && pathname === "/profesor")   return true;
  if (href === "/estudiante" && pathname === "/estudiante") return true;
  if (href !== "/admin" && href !== "/profesor" && href !== "/estudiante") {
    return pathname === href || pathname.startsWith(href + "/");
  }
  return false;
}
