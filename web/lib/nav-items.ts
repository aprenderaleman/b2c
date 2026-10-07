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

export const NAV_BY_ROLE: Record<Role, NavItem[]> = {
  superadmin: adminItems(),
  admin:      adminItems(),
  teacher: [
    { label: "Hoy",              href: "/profesor",                 icon: "home",           priority: 1 },
    { label: "Calendario",       href: "/profesor/calendario",      icon: "calendarDays",   priority: 1.5 },
    { label: "Mis clases",       href: "/profesor/clases",          icon: "calendarDays",   priority: 2 },
    { label: "Clases de prueba", href: "/profesor/clasedeprueba",   icon: "userCheck",      priority: 2.5 },
    // "Mis leads" oculto (Gelfis 2026-10-07, simplificación del panel).
    { label: "Estudiantes",      href: "/profesor/estudiantes",     icon: "graduationCap",  priority: 3 },
    { label: "Mensajes",         href: "/profesor/mensajes",        icon: "messageCircle",  priority: 3.5 },
    { label: "Ganancias",        href: "/profesor/ganancias",       icon: "wallet",         priority: 4 },
    // "Disponibilidad" oculta del menú (Gelfis 2026-10-07) — se edita
    // igual desde Calendario, que incluye el mismo editor + bloqueos.
    // "Materiales" oculto del menú (Gelfis 2026-10-01) — la ruta sigue viva,
    // pero el contenido canónico ahora son los Cursos (SCHULE).
    // "Recursos" restaurado (Gelfis 2026-10-09 — Sabine los necesita;
    // estuvo oculto del 07 al 09).
    { label: "Recursos",         href: "/profesor/recursos",        icon: "bookOpen",       priority: 6.2 },
    { label: "Grabaciones",      href: "/profesor/grabaciones",     icon: "video",          priority: 6.5 },
    // Cursos destacado: justo debajo de "Hoy" (Gelfis 2026-10-01).
    { label: "Cursos",           href: "/profesor/cursos",          icon: "graduationCap",  priority: 1.1 },
  ],
  student: [
    { label: "Hoy",          href: "/estudiante",               icon: "home",           priority: 1 },
    { label: "Mis clases",   href: "/estudiante/clases",        icon: "calendarDays",   priority: 2 },
    { label: "Apuntes",     href: "/estudiante/apuntes",       icon: "fileText",       priority: 2.3 },
    { label: "Mensajes",    href: "/estudiante/mensajes",      icon: "messageCircle",  priority: 2.5 },
    // "Material" oculto del menú (Gelfis 2026-10-01) — ruta viva; el
    // contenido canónico son los Cursos (SCHULE).
    { label: "Grabaciones",  href: "/estudiante/grabaciones",   icon: "video",          priority: 3.5 },
    // Cursos destacado: justo debajo de "Hoy" (Gelfis 2026-10-01).
    { label: "Cursos",       href: "/estudiante/cursos",        icon: "graduationCap",  priority: 1.1 },
    { label: "Certificados", href: "/estudiante/certificados",  icon: "award",          priority: 6 },
  ],
  closer: closerItems(),
  setter: setterItems(),
};

function adminItems(): NavItem[] {
  return [
    { label: "Hoy",                href: "/admin",                icon: "home",          priority: 1 },
    { label: "Clases",             href: "/admin/clases",         icon: "calendarDays",  priority: 2 },
    { label: "Clases de prueba",   href: "/admin/clasedeprueba",  icon: "userCheck",     priority: 2.3 },
    { label: "Mi disponibilidad",  href: "/admin/disponibilidad", icon: "clock",         priority: 2.4 },
    { label: "Grabaciones",      href: "/admin/grabaciones",    icon: "video",         priority: 2.5 },
    { label: "Estudiantes", href: "/admin/estudiantes", icon: "graduationCap", priority: 3 },
    { label: "Empresa",    href: "/admin/empresa",     icon: "trendingUp",    priority: 3.5 },
    { label: "Finanzas",    href: "/admin/finanzas",    icon: "wallet",        priority: 4 },
    { label: "Horas",       href: "/admin/horas",       icon: "clock",         priority: 4.5 },
    // "Funnel" unifica los antiguos /admin/leads + /admin/ads en una
    // sola página (KPIs + lista de leads + atribución por landing). Las
    // rutas viejas siguen redirigiendo aquí, pero el menú apunta directo.
    { label: "Funnel",      href: "/admin/funnel",      icon: "users",         priority: 6 },
    { label: "Profesores",  href: "/admin/profesores",  icon: "userCheck",     priority: 7 },
    { label: "Reseñas",     href: "/admin/resenas",     icon: "star",          priority: 8.5 },
    { label: "Referidos",   href: "/admin/referidos",   icon: "heart",         priority: 8.7 },
    { label: "Comunicados", href: "/admin/comunicados", icon: "messageCircle", priority: 9 },
    { label: "Closers",     href: "/admin/closers",     icon: "userCheck",     priority: 9.5 },
    // Ocultos del menú (Gelfis 2026-10-07, simplificación de la vista
    // admin) — las rutas siguen vivas por enlace directo: Sesiones Plan
    // (/admin/sesiones), Grupos (/admin/grupos), Semáforo
    // (/admin/semaforo), Reportes (/admin/reportes), Setters
    // (/admin/setters), Reactivación (/admin/reactivacion),
    // Aprobaciones (/admin/aprobaciones) y Config CRM
    // (/admin/config/cadencia).
  ];
}

function closerItems(): NavItem[] {
  return [
    // "Hoy" (cola aparte) eliminada — Mis leads es la cola, ordenada
    // por semáforo (Gelfis 2026-08-17).
    { label: "Mis leads",          href: "/closer/leads",          icon: "users",      priority: 1 },
    { label: "Sesiones",           href: "/closer/sesiones",       icon: "userCheck",  priority: 2.5 },
    { label: "Calendario",         href: "/closer/calendario",     icon: "calendarDays", priority: 2.7 },
    { label: "Mis numeros",        href: "/closer/numeros",        icon: "trendingUp", priority: 3 },
    { label: "Grabaciones",         href: "/closer/grabaciones",    icon: "video",      priority: 3.5 },
    { label: "Mi disponibilidad",  href: "/closer/disponibilidad", icon: "clock",      priority: 5 },
    { label: "Perfil",             href: "/closer/perfil",         icon: "userCircle", priority: 4 },
  ];
}

function setterItems(): NavItem[] {
  return [
    // La cola ES su home: citas por confirmar, hoy/mañana, no-shows y
    // backlog, con su marcador (métricas) arriba.
    { label: "Mi cola",  href: "/setter",        icon: "users",      priority: 1 },
    { label: "Perfil",   href: "/setter/perfil", icon: "userCircle", priority: 2 },
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
