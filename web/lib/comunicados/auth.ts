import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

/**
 * Shared guard for the /api/admin/comunicados/* routes.
 * Returns either the admin's user id, or a NextResponse to short-circuit with.
 */
export async function requireAdminApi(): Promise<
  | { ok: true;  adminUserId: string }
  | { ok: false; res: NextResponse }
> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, res: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }
  const role = (session.user as { role?: string }).role;
  const id   = (session.user as { id?: string }).id;
  if (role !== "admin" && role !== "superadmin") {
    return { ok: false, res: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }
  if (!id) {
    return { ok: false, res: NextResponse.json({ error: "no_user_id" }, { status: 500 }) };
  }
  return { ok: true, adminUserId: id };
}
