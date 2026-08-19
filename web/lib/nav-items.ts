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
  external?: boolean;            // true → opens in new tab via plain <a>
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
  | "video"
  | "star"
  | "trendingUp"
  | "heart"
  | "refreshCw";

export const NAV_BY_ROLE: Record<Exclude<Role, "teacher" | "student" | "closer"> | "admin" | "teacher" | "student" | "closer", NavItem[]> = {
  superadmin: adminItems(),
  admin:      adminItems(),
  teacher: [
    { label: "Hoy",              href: "/profesor",                 icon: "home",           priority: 1 },
    { label: "Mis clases",       href: "/profesor/clases",          icon: "calendarDays",   priority: 2 },
    { label: "Clases de prueba", href: "/profesor/clasedeprueba",   icon: "userCheck",      priority: 2.5 },
    { label: "Mis leads",        href: "/profesor/leads",           icon: "users",          priority: 2.7 },
    { label: "Estudiantes",      href: "/profesor/estudiantes",     icon: "graduationCap",  priority: 3 },
    { label: "Ganancias",        href: "/profesor/ganancias",       icon: "wallet",         priority: 4 },
    { label: "Disponibilidad",   href: "/profesor/disponibilidad",  icon: "clock",          priority: 5 },
    { label: "Materiales",       href: "/profesor/materiales",      icon: "folder",         priority: 6 },
    { label: "Recursos",         href: "/profesor/recursos",        icon: "bookOpen",       priority: 6.2 },
    { label: "Grabaciones",      href: "/profesor/grabaciones",     icon: "video",          priority: 6.5 },
  ],
  student: [
    { label: "Hoy",          href: "/estudiante",               icon: "home",           priority: 1 },
    { label: "Mis clases",   href: "/estudiante/clases",        icon: "calendarDays",   priority: 2 },
    { label: "Apuntes",     href: "/estudiante/apuntes",       icon: "fileText",       priority: 2.3 },
    { label: "Material",     href: "/estudiante/materiales",    icon: "bookOpen",       priority: 3 },
    { label: "Biblioteca",   href: "/estudiante/biblioteca",    icon: "folder",         priority: 3.3 },
    { label: "Grabaciones",  href: "/estudiante/grabaciones",   icon: "video",          priority: 3.5 },
    { label: "Tareas",       href: "/estudiante/tareas",        icon: "fileText",       priority: 4 },
    { label: "Certificados", href: "/estudiante/certificados",  icon: "award",          priority: 6 },
  ],
  closer: closerItems(),
};

function adminItems(): NavItem[] {
  return [
    { label: "Hoy",                href: "/admin",                icon: "home",          priority: 1 },
    { label: "Clases",             href: "/admin/clases",         icon: "calendarDays",  priority: 2 },
    { label: "Clases de prueba",   href: "/admin/clasedeprueba",  icon: "userCheck",     priority: 2.3 },
    { label: "Sesiones Plan",      href: "/admin/sesiones",       icon: "userCheck",     priority: 2.35 },
    { label: "Mi disponibilidad",  href: "/admin/disponibilidad", icon: "clock",         priority: 2.4 },
    { label: "Grabaciones",      href: "/admin/grabaciones",    icon: "video",         priority: 2.5 },
    { label: "Estudiantes", href: "/admin/estudiantes", icon: "graduationCap", priority: 3 },
    { label: "Empresa",    href: "/admin/empresa",     icon: "trendingUp",    priority: 3.5 },
    { label: "Finanzas",    href: "/admin/finanzas",    icon: "wallet",        priority: 4 },
    { label: "Horas",       href: "/admin/horas",       icon: "clock",         priority: 4.5 },
    { label: "Grupos",      href: "/admin/grupos",      icon: "folder",        priority: 5 },
    // "Funnel" unifica los antiguos /admin/leads + /admin/ads en una
    // sola página (KPIs + lista de leads + atribución por landing). Las
    // rutas viejas siguen redirigiendo aquí, pero el menú apunta directo.
    { label: "Funnel",      href: "/admin/funnel",      icon: "users",         priority: 6 },
    { label: "Semáforo",    href: "/admin/semaforo",    icon: "clock",         priority: 6.5 },
    { label: "Profesores",  href: "/admin/profesores",  icon: "userCheck",     priority: 7 },
    { label: "Reportes",    href: "/admin/reportes",    icon: "barChart3",     priority: 8 },
    { label: "Reseñas",     href: "/admin/resenas",     icon: "star",          priority: 8.5 },
    { label: "Referidos",   href: "/admin/referidos",   icon: "heart",         priority: 8.7 },
    { label: "Comunicados", href: "/admin/comunicados", icon: "messageCircle", priority: 9 },
    { label: "Closers",     href: "/admin/closers",     icon: "userCheck",     priority: 9.5 },
    { label: "Reactivacion",href: "/admin/reactivacion", icon: "refreshCw",   priority: 9.55 },
    { label: "Aprobaciones",href: "/admin/aprobaciones", icon: "wallet",       priority: 9.6 },
    { label: "Config CRM",  href: "/admin/config/cadencia", icon: "barChart3", priority: 9.7 },
  ];
}

function closerItems(): NavItem[] {
  return [
    // "Hoy" (cola aparte) eliminada — Mis leads es la cola, ordenada
    // por semáforo (Gelfis 2026-08-17).
    { label: "Mis leads",          href: "/closer/leads",          icon: "users",      priority: 1 },
    { label: "Sesiones",           href: "/closer/sesiones",       icon: "userCheck",  priority: 2.5 },
    { label: "Mis numeros",        href: "/closer/numeros",        icon: "trendingUp", priority: 3 },
    { label: "Mi disponibilidad",  href: "/closer/disponibilidad", icon: "clock",      priority: 5 },
    { label: "Perfil",             href: "/closer/perfil",         icon: "userCircle", priority: 4 },
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
