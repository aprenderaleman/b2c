import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth.config";

export const { auth: middleware } = NextAuth(authConfig);

export const config = {
  // Protect every role-scoped area. Exact gating logic lives in
  // authConfig.callbacks.authorized so we have a single source of truth.
  matcher: [
    "/admin/:path*",
    "/profesor/:path*",
    "/estudiante/:path*",
    "/aula/:path*",
    "/grabacion/:path*",
    "/chat/:path*",
  ],
};
