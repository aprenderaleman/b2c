// Edge-safe NextAuth config. No bcrypt, no Supabase client. Used by middleware.
// The full config (with Credentials.authorize that uses bcrypt + DB lookup)
// lives in lib/auth.ts and is only imported from Node routes / server actions.

import type { NextAuthConfig } from "next-auth";

type Role = "superadmin" | "admin" | "teacher" | "student";

/**
 * Which routes are gated, and which roles are allowed on each.
 * Order matters: we match the first prefix that hits.
 */
const PROTECTED: Array<{ prefix: string; roles: Role[] }> = [
  { prefix: "/admin",      roles: ["superadmin", "admin"] },
  { prefix: "/profesor",   roles: ["superadmin", "admin", "teacher"] },
  { prefix: "/estudiante", roles: ["superadmin", "admin", "student"] },
  { prefix: "/aula",       roles: ["superadmin", "admin", "teacher", "student"] },
  { prefix: "/grabacion",  roles: ["superadmin", "admin", "teacher", "student"] },
  { prefix: "/chat",       roles: ["superadmin", "admin", "teacher", "student"] },
];

function defaultPathForRole(role: Role): string {
  switch (role) {
    case "superadmin":
    case "admin":   return "/admin";
    case "teacher": return "/profesor";
    case "student": return "/estudiante";
  }
}

export const authConfig: NextAuthConfig = {
  session: { strategy: "jwt" },
  pages:   { signIn: "/login" },
  providers: [],   // filled in by lib/auth.ts (Node-only)
  callbacks: {
    authorized: ({ auth, request }) => {
      const { pathname } = request.nextUrl;

      // Legacy alias: /admin/login is now /login. Let it through so the
      // redirect handler (app/admin/login/page.tsx) can fire.
      if (pathname === "/admin/login") return true;

      const gate = PROTECTED.find(g => pathname.startsWith(g.prefix));
      if (!gate) return true;   // public route

      if (!auth?.user) return false;   // NextAuth will redirect to /login

      const role = (auth.user as { role?: Role }).role;
      if (!role) return false;
      if (gate.roles.includes(role)) return true;

      // Authenticated but wrong role → bounce them to their own home.
      // We signal this by returning a Response that NextAuth forwards.
      return Response.redirect(new URL(defaultPathForRole(role), request.nextUrl));
    },
  },
};
