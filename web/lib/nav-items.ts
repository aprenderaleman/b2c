import type { Role } from "@/lib/rbac";

/**
 * Single source of truth for app navigation. Each role has its own
 * ordered list; the sidebar (desktop) renders all of them, the mobile
 * bottom bar renders the first 4, and the "More" drawer renders the rest.
 *
 * Icons are rendered via lucide-react in the nav components — we keep
 * just the name here so this file stays serializable.
 */

export type NavItem = {
  label:    string;
  href:     string;
  icon:     NavIconKey;          // lucide icon name (see NavIcon)
  priority: number;              // lower = shows first in bottom bar
};

export type NavIconKey =
  | "home"
  | "users"
  | "userCheck"
  | "graduationCap"
  | "calendarDays"
  | "wallet"
  | "barChart3"
  | "messageCircle"
  | "bookOpen"
  | "clock"
  | "fileText"
  | "folder"
  | "award"
  | "userCircle"
  | "video";

export const NAV_BY_ROLE: Record<Exclude<Role, "teacher" | "student"> | "admin" | "teacher" | "student", NavItem[]> = {
  superadmin: adminItems(),
  admin:      adminItems(),
  teacher: [
    { label: "Hoy",            href: "/profesor",                 icon: "home",           priority: 1 },
    { label: "Mis clases",     href: "/profesor/clases",          icon: "calendarDays",   priority: 2 },
    { label: "Estudiantes",    href: "/profesor/estudiantes",     icon: "graduationCap",  priority: 3 },
    { label: "Mis grupos",     href: "/profesor/grupos",          icon: "folder",         priority: 3.5 },
    { label: "Ganancias",      href: "/profesor/ganancias",       icon: "wallet",         priority: 4 },
    { label: "Disponibilidad", href: "/profesor/disponibilidad",  icon: "clock",          priority: 5 },
    { label: "Materiales",     href: "/profesor/materiales",      icon: "folder",         priority: 6 },
    { label: "Chat",           href: "/chat",                      icon: "messageCircle",  priority: 7 },
  ],
  student: [
    { label: "Hoy",          href: "/estudiante",               icon: "home",           priority: 1 },
    { label: "Mis clases",   href: "/estudiante/clases",        icon: "calendarDays",   priority: 2 },
    { label: "Material",     href: "/estudiante/materiales",    icon: "bookOpen",       priority: 3 },
    { label: "Tareas",       href: "/estudiante/tareas",        icon: "fileText",       priority: 4 },
    { label: "Chat",         href: "/chat",                      icon: "messageCircle",  priority: 5 },
    { label: "Certificados", href: "/estudiante/certificados",  icon: "award",          priority: 6 },
  ],
};

function adminItems(): NavItem[] {
  return [
    { label: "Hoy",         href: "/admin",             icon: "home",          priority: 1 },
    { label: "Clases",      href: "/admin/clases",      icon: "calendarDays",  priority: 2 },
    { label: "Grabaciones", href: "/admin/grabaciones", icon: "video",         priority: 2.5 },
    { label: "Estudiantes", href: "/admin/estudiantes", icon: "graduationCap", priority: 3 },
    { label: "Finanzas",    href: "/admin/finanzas",    icon: "wallet",        priority: 4 },
    { label: "Grupos",      href: "/admin/grupos",      icon: "folder",        priority: 5 },
    { label: "Leads",       href: "/admin/leads",       icon: "users",         priority: 6 },
    { label: "Profesores",  href: "/admin/profesores",  icon: "userCheck",     priority: 7 },
    { label: "Reportes",    href: "/admin/reportes",    icon: "barChart3",     priority: 8 },
    { label: "Comunicados", href: "/admin/comunicados", icon: "messageCircle", priority: 9 },
    { label: "Chat",        href: "/chat",               icon: "messageCircle", priority: 10 },
  ];
}

/** The first 4 items (lowest priority numbers) go in the mobile bottom bar. */
export function bottomNavItems(items: NavItem[]): NavItem[] {
  return [...items].sort((a, b) => a.priority - b.priority).slice(0, 4);
}

/** Everything beyond the first 4 goes into the "Más" drawer. */
export function drawerExtras(items: NavItem[]): NavItem[] {
  return [...items].sort((a, b) => a.priority - b.priority).slice(4);
}
