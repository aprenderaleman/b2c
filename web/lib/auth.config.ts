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
    // JWT + session callbacks MUST live here (not in lib/auth.ts) so the
    // edge middleware can read `auth.user.role` without re-running the
    // providers. Without this the middleware saw session.user without a
    // role and bounced every authenticated request back to /login.
    jwt: ({ token, user }) => {
      if (user) {
        const u = user as { id?: string; role?: Role };
        if (u.id)   token.id   = u.id;
        if (u.role) token.role = u.role;
      }
      return token;
    },
    session: ({ session, token }) => {
      if (session.user) {
        (session.user as { id?: string }).id  = (token.id   as string | undefined) ?? "";
        (session.user as { role?: Role }).role = (token.role as Role   | undefined);
      }
      return session;
    },

    authorized: ({ auth, request }) => {
      const { pathname } = request.nextUrl;

      // Legacy alias: /admin/login is now /login. Let it through so the
      // redirect handler (app/admin/login/page.tsx) can fire.
      if (pathname === "/admin/login") return true;

      const gate = PROTECTED.find(g => pathname.startsWith(g.prefix));
      if (!gate) return true;   // public route

      // /aula and /grabacion accept TWO credentials:
      //   1. NextAuth session (admin / teacher / student logged in), OR
      //   2. `aa_trial_session` cookie (trial-magic-link lead — no user
      //      row, came in via /c/{code} or /trial/{classId}?t={token}).
      //
      // Without this branch the lead's link bounces to /login because
      // they have no NextAuth user. The page-level code in /aula/[id]
      // validates the cookie's HMAC + class_id properly, so letting an
      // unverified cookie value through here is safe — a forged cookie
      // can't pass `getTrialSession()` server-side.
      const isTrialOpenRoute = gate.prefix === "/aula" || gate.prefix === "/grabacion";
      if (isTrialOpenRoute) {
        const trialCookie = request.cookies.get("aa_trial_session")?.value;
        if (trialCookie) return true;
      }

      if (!auth?.user) return false;   // NextAuth will redirect to /login

      const role = (auth.user as { role?: Role }).role;
      // No role on the session token → treat as unauthenticated. Happens
      // when the JWT was minted by an older build; returning false lets
      // NextAuth redirect to /login, the user signs in again, and the
      // new JWT carries the role claim.
      if (!role) return false;
      if (gate.roles.includes(role)) return true;

      // Authenticated but wrong role → bounce them to their own home.
      return Response.redirect(new URL(defaultPathForRole(role), request.nextUrl));
    },
  },
};
