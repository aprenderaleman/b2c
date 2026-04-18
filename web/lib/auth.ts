import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { authConfig } from "./auth.config";
import { supabaseAdmin } from "./supabase";

// Full config — this file is Node-only (bcrypt + supabase). Do NOT import
// from middleware.

type Role = "superadmin" | "admin" | "teacher" | "student";

type UserRow = {
  id: string;
  email: string;
  password_hash: string;
  role: Role;
  full_name: string | null;
  active: boolean;
};

/**
 * Resolve a login attempt against the canonical `users` table (created in
 * migration 004). If the table doesn't exist yet OR the caller's email
 * isn't found there, we fall back to the legacy ADMIN_EMAIL/ADMIN_PASSWORD_HASH
 * env pair so Gelfis never gets locked out during the LMS migration window.
 *
 * Returns a minimal session user, or null if auth fails.
 */
async function verifyCredentials(
  email: string,
  password: string,
): Promise<null | {
  id: string;
  email: string;
  name: string | null;
  role: Role;
}> {
  // 1) Canonical path: look the user up in `users`.
  try {
    const sb = supabaseAdmin();
    const { data, error } = await sb
      .from("users")
      .select("id, email, password_hash, role, full_name, active")
      .eq("email", email)
      .maybeSingle();

    if (!error && data) {
      const row = data as UserRow;
      if (!row.active) return null;
      const ok = await bcrypt.compare(password, row.password_hash);
      if (!ok) return null;

      // Fire-and-forget update of last_login_at (don't block the return).
      sb.from("users")
        .update({ last_login_at: new Date().toISOString() })
        .eq("id", row.id)
        .then(() => { /* noop */ });

      return {
        id:    row.id,
        email: row.email,
        name:  row.full_name,
        role:  row.role,
      };
    }
    // If we got an error other than "table doesn't exist", bail out (don't
    // silently fall back). The legacy fallback is ONLY for the migration
    // window where `users` doesn't exist yet.
    if (error && !isMissingTableError(error)) {
      console.error("users lookup failed:", error.message);
      return null;
    }
  } catch (e) {
    // If Supabase env vars aren't set or the client can't connect, fall
    // through to the env-var fallback so local dev still works.
    console.error("users lookup threw:", e);
  }

  // 2) Legacy fallback: single-admin via env vars. Only triggers if the
  //    users table is missing or the email isn't found there.
  const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const adminHash  = process.env.ADMIN_PASSWORD_HASH;
  if (!adminEmail || !adminHash) return null;
  if (email !== adminEmail) return null;
  const ok = await bcrypt.compare(password, adminHash);
  if (!ok) return null;

  return {
    id:    "env-admin",
    email: adminEmail,
    name:  "Gelfis",
    role:  "superadmin",
  };
}

function isMissingTableError(err: { code?: string; message?: string }): boolean {
  // PostgREST returns 42P01 for "relation does not exist"; also match the text
  // in case Supabase maps it differently.
  if (err.code === "42P01") return true;
  return /relation .* does not exist|schema cache/i.test(err.message ?? "");
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      name: "Academy",
      credentials: {
        email:    { label: "Email",    type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (creds) => {
        const email = String(creds?.email ?? "").trim().toLowerCase();
        const pw    = String(creds?.password ?? "");
        if (!email || !pw) return null;
        return verifyCredentials(email, pw);
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    // Propagate `role` and `id` into the JWT so the session has them.
    jwt: async ({ token, user }) => {
      if (user) {
        const u = user as { id?: string; role?: Role };
        if (u.id)   token.id   = u.id;
        if (u.role) token.role = u.role;
      }
      return token;
    },
    session: async ({ session, token }) => {
      if (session.user) {
        (session.user as { id?: string }).id   = (token.id   as string | undefined) ?? "";
        (session.user as { role?: Role }).role = (token.role as Role   | undefined) ?? "superadmin";
      }
      return session;
    },
  },
});
