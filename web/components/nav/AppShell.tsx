"use client";

import { useState } from "react";
import { NotificationsBell } from "@/components/NotificationsBell";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Logo } from "@/components/Logo";
import { SidebarDesktop } from "./SidebarDesktop";
import { BottomNavMobile } from "./BottomNavMobile";
import { ImpersonatePicker } from "./ImpersonatePicker";
import { bottomNavItems, drawerExtras, type NavItem } from "@/lib/nav-items";
import type { Role } from "@/lib/rbac";

/**
 * Role-aware app shell. Renders:
 *   - Desktop (≥lg): sidebar + top header + main content
 *   - Mobile  (<lg): compact header + content + fixed bottom tab bar
 *
 * The server component layout passes `items`, `role`, `userDisplayName`,
 * `impersonated` and the server-action `logoutAction`; everything
 * interactive happens here.
 */
export function AppShell({
  items,
  role,
  userDisplayName,
  impersonated,
  logoutForm,
  children,
}: {
  items:           NavItem[];
  role:            Role;
  userDisplayName: string;
  impersonated:    boolean;
  logoutForm:      React.ReactNode;     // a <form action={serverAction}> with a submit button
  children:        React.ReactNode;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const primary = bottomNavItems(items);
  const extras  = drawerExtras(items);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex">
      <SidebarDesktop
        items={items}
        role={role}
        impersonated={impersonated}
        onOpenImpersonate={() => setPickerOpen(true)}
      />

      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top header — minimal on desktop, compact on mobile */}
        <header className="sticky top-0 z-30 h-14 border-b border-slate-200 dark:border-slate-800 bg-white/90 dark:bg-slate-900/90 backdrop-blur flex items-center px-4 sm:px-6 gap-3">
          <div className="lg:hidden">
            <Logo variant="compact" href={defaultHome(role)} size={32} />
          </div>
          <div className="flex-1" />
          <NotificationsBell />
          <ThemeToggle />
          <span
            className="hidden lg:inline-block [&_button]:text-xs [&_button]:font-medium [&_button]:text-slate-600 dark:[&_button]:text-slate-300 [&_button]:hover:text-brand-600 dark:[&_button]:hover:text-brand-400"
            title={userDisplayName}
          >
            {logoutForm}
          </span>
        </header>

        <main className="flex-1 pb-[calc(env(safe-area-inset-bottom)+4.5rem)] lg:pb-6">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 py-4 sm:py-6">
            {children}
          </div>
        </main>
      </div>

      <BottomNavMobile
        primary={primary}
        extras={extras}
        logoutForm={logoutForm}
      />

      <ImpersonatePicker open={pickerOpen} onClose={() => setPickerOpen(false)} />
    </div>
  );
}

function defaultHome(role: Role): string {
  if (role === "teacher") return "/profesor";
  if (role === "student") return "/estudiante";
  return "/admin";
}
