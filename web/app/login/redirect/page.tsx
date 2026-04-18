import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { defaultPathForRole, type Role } from "@/lib/rbac";

/**
 * NextAuth signs the user in and then navigates here. We read the role
 * off the session and bounce them to the right home. Keeps the role →
 * path mapping centralised in defaultPathForRole().
 */
export default async function LoginRedirect() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const role = (session.user as { role?: Role }).role ?? "superadmin";
  redirect(defaultPathForRole(role));
}
