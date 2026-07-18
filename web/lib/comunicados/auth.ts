import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * Shared guard for the /api/admin/comunicados/* routes.
 * Returns either the admin's user id, or a NextResponse to short-circuit with.
 *
 * If the JWT is stale and missing the `role` claim (happens after a config
 * change that altered the session shape), we fall back to a single DB lookup
 * rather than forcing the user to sign out. This costs one extra query only
 * in that rare case.
 */
export async function requireAdminApi(): Promise<
  | { ok: true;  adminUserId: string }
  | { ok: false; res: NextResponse }
> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, res: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }

  let role = (session.user as { role?: string }).role;
  const id  = (session.user as { id?: string }).id;

  if (!id) {
    return { ok: false, res: NextResponse.json({ error: "no_user_id" }, { status: 500 }) };
  }

  // JWT is stale and missing the role claim — fetch it from the DB so the
  // user doesn't have to sign out and back in just to get the claim refreshed.
  if (!role && id !== "env-admin") {
    const { data } = await supabaseAdmin()
      .from("users")
      .select("role")
      .eq("id", id)
      .maybeSingle();
    role = (data as { role?: string } | null)?.role ?? undefined;
  }

  // env-admin fallback (legacy env-var login) is always superadmin.
  if (id === "env-admin") role = "superadmin";

  if (role !== "admin" && role !== "superadmin") {
    return { ok: false, res: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }

  return { ok: true, adminUserId: id };
}
