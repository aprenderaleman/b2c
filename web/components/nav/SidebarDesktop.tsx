"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/Logo";
import { NavIcon } from "./NavIcon";
import type { NavItem } from "@/lib/nav-items";
import type { Role } from "@/lib/rbac";

/**
 * Desktop sidebar (≥lg). Fixed 260px wide, icon + label, active state
 * highlighted in brand orange. Admin gets a "Ver como…" button at the
 * bottom that opens the impersonation picker.
 */
export function SidebarDesktop({
  items,
  role,
  impersonated,
  onOpenImpersonate,
}: {
  items:        NavItem[];
  role:         Role;
  impersonated: boolean;
  onOpenImpersonate: () => void;
}) {
  const pathname = usePathname();
  const isAdmin  = role === "admin" || role === "superadmin";

  return (
    <aside className="hidden lg:flex w-[260px] shrink-0 flex-col border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
      <div className="px-5 py-5 border-b border-slate-100 dark:border-slate-800">
        <Logo variant="full" href={defaultHome(role)} />
      </div>

      <nav className="flex-1 overflow-y-auto py-3 px-3 space-y-0.5">
        {items.map(it => {
          const active = isActive(pathname, it.href);
          return (
            <Link
              key={it.href}
              href={it.href}
              className={`group flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors
                ${active
                  ? "bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300"
                  : "text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                }`}
            >
              <NavIcon name={it.icon} className={`h-[18px] w-[18px] ${active ? "text-brand-600 dark:text-brand-400" : ""}`} />
              <span className="truncate">{it.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Role pill + Ver como */}
      <div className="border-t border-slate-100 dark:border-slate-800 p-3 space-y-2">
        <RolePill role={role} impersonated={impersonated} />
        {isAdmin && !impersonated && (
          <button
            type="button"
            onClick={onOpenImpersonate}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 px-3 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 hover:border-brand-400 hover:text-brand-600 dark:hover:text-brand-400 transition-colors"
          >
            <NavIcon name="userCircle" className="h-4 w-4" />
            Ver como usuario…
          </button>
        )}
      </div>
    </aside>
  );
}

function defaultHome(role: Role): string {
  if (role === "teacher") return "/profesor";
  if (role === "student") return "/estudiante";
  return "/admin";
}

function isActive(pathname: string, href: string): boolean {
  if (href === "/admin"     && pathname === "/admin")     return true;
  if (href === "/profesor"  && pathname === "/profesor")  return true;
  if (href === "/estudiante"&& pathname === "/estudiante")return true;
  if (href !== "/admin" && href !== "/profesor" && href !== "/estudiante") {
    return pathname === href || pathname.startsWith(href + "/");
  }
  return false;
}

function RolePill({ role, impersonated }: { role: Role; impersonated: boolean }) {
  const label =
    role === "superadmin" ? "Superadmin" :
    role === "admin"      ? "Admin"      :
    role === "teacher"    ? "Profesor"   :
                            "Estudiante";
  const emoji =
    role === "teacher" ? "👨‍🏫" :
    role === "student" ? "🎓"   :
                         "🛡️";
  return (
    <div className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium
      ${impersonated
        ? "bg-amber-100 dark:bg-amber-500/15 text-amber-800 dark:text-amber-200 border border-amber-300/60"
        : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200/60 dark:border-slate-700/60"}`}>
      <span aria-hidden>{emoji}</span>
      <span>Vista: {label}</span>
      {impersonated && <span className="ml-auto text-[10px] uppercase tracking-wider">Simulado</span>}
    </div>
  );
}
