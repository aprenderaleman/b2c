import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { authConfig } from "./auth.config";

// Full config — this file is Node-only (bcrypt). Do NOT import from middleware.

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      name: "Admin",
      credentials: {
        email:    { label: "Email",    type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (creds) => {
        const adminEmail = process.env.ADMIN_EMAIL;
        const adminHash  = process.env.ADMIN_PASSWORD_HASH;
        if (!adminEmail || !adminHash) return null;

        const email = String(creds?.email ?? "").trim().toLowerCase();
        const pw    = String(creds?.password ?? "");
        if (email !== adminEmail.trim().toLowerCase()) return null;

        const ok = await bcrypt.compare(pw, adminHash);
        if (!ok) return null;

        return { id: "admin", email: adminEmail, name: "Gelfis" };
      },
    }),
  ],
});
