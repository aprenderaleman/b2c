import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { defaultPathForRole, type Role } from "@/lib/rbac";

/**
 * NextAuth signs the user in and then navigates here. We read the role
 * off the session and bounce them to the right home. Keeps the role →
 * path mapping centralised in defaultPathForRole().
 *
 * If the session token is missing `role` (happens when the cookie was
 * minted by an older build before we added the claim), sending the user
 * to /admin with no role causes a redirect loop. Force them back to
 * /login so they can sign in again and mint a fresh JWT.
 */
export default async function LoginRedirect() {
  const session = await auth();
  const role    = (session?.user as { role?: Role } | undefined)?.role;
  if (!session?.user || !role) redirect("/login");
  redirect(defaultPathForRole(role));
}
