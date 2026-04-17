// Edge-safe NextAuth config. No bcrypt, no psycopg. Used by middleware.
// The full config (with Credentials.authorize that uses bcrypt) lives in
// lib/auth.ts and is only imported from Node routes / server actions.

import type { NextAuthConfig } from "next-auth";

export const authConfig: NextAuthConfig = {
  session: { strategy: "jwt" },
  pages: { signIn: "/admin/login" },
  providers: [],   // filled in by lib/auth.ts
  callbacks: {
    authorized: ({ auth, request }) => {
      const { pathname } = request.nextUrl;
      if (pathname.startsWith("/admin") && pathname !== "/admin/login") {
        return !!auth;
      }
      return true;
    },
  },
};
