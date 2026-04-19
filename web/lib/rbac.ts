/**
 * Role-Based Access Control helpers.
 *
 * Use these in server components / API routes to enforce that only users
 * with a given role can reach a piece of functionality. Any handler that
 * reads user data should start with:
 *
 *     const session = await requireRole(['superadmin', 'admin']);
 *
 * `requireRole` throws a redirect to /login if the caller isn't
 * authenticated, and a 403 if they are but their role is wrong.
 */

import { redirect } from "next/navigation";
import { auth } from "./auth";
import { getImpersonation } from "./impersonation";

export type Role = "superadmin" | "admin" | "teacher" | "student";

export type AuthedSession = {
  user: {
    id: string;
    email: string;
    name: string | null;
    role: Role;
  };
};

/**
 * Default landing path once a user is authenticated, based on their role.
 * Used by /login after successful sign-in and by middleware redirects.
 */
export function defaultPathForRole(role: Role): string {
  switch (role) {
    case "superadmin":
    case "admin":   return "/admin";
    case "teacher": return "/profesor";
    case "student": return "/estudiante";
  }
}

/**
 * Require the caller to have any of `roles`. Redirects to /login if not
 * signed in; to "/" (home) if signed in but with the wrong role.
 *
 * Typed return makes downstream code null-safe without extra checks.
 */
export async function requireRole(roles: Role[]): Promise<AuthedSession> {
  const session = await auth();
  if (!session?.user) redirect(`/login?next=${encodeURIComponent(currentPath())}`);

  // Narrow through the session.user shape (it's widened by NextAuth typings).
  const role = (session.user as { role?: Role }).role;
  if (!role) redirect("/login");

  if (!roles.includes(role)) {
    // Wrong role: send them to THEIR home instead of hard-404ing.
    redirect(defaultPathForRole(role));
  }

  return {
    user: {
      id:    (session.user as { id: string }).id,
      email: session.user.email ?? "",
      name:  session.user.name ?? null,
      role,
    },
  };
}

/**
 * Best-effort path snapshot for the "next" redirect param. This only runs
 * on the server; we can't read window.location, so we return the empty
 * string and let the caller stay on /login if cookies unlock later.
 */
function currentPath(): string {
  return "/";
}

/**
 * Like requireRole, but if the caller is admin AND there is an active
 * impersonation cookie pointing at a user with the expected role, the
 * returned session.user.id / role / email / name belong to the target.
 * A third field, `impersonation`, is populated so pages can show "you are
 * viewing as X" hints (the sticky banner already lives at the layout
 * level; this is just data).
 *
 * Use this in /estudiante/* and /profesor/* pages so "Ver como" actually
 * loads the target's data.
 */
export async function requireRoleWithImpersonation(
  allowed:    Role[],
  expectRole: "teacher" | "student",
): Promise<AuthedSession & {
  impersonation: null | { admin_id: string; admin_name: string; original_user_id: string };
}> {
  const session = await requireRole(allowed);
  const imp     = await getImpersonation();

  const canImpersonate = session.user.role === "admin" || session.user.role === "superadmin";
  if (!imp || !canImpersonate || imp.target_role !== expectRole) {
    return { ...session, impersonation: null };
  }

  return {
    user: {
      id:    imp.target_id,
      email: imp.target_email,
      name:  imp.target_name,
      role:  imp.target_role,
    },
    impersonation: {
      admin_id:         imp.admin_id,
      admin_name:       imp.admin_name,
      original_user_id: session.user.id,
    },
  };
}
