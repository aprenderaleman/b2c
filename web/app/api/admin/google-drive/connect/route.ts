import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { adminDriveOAuthConfigured, buildAdminDriveOAuthUrl, signAdminState } from "@/lib/admin-google-drive";

/** GET /api/admin/google-drive/connect — lanza el consentimiento de Google (scope drive). */
export async function GET() {
  const session = await auth();
  const user = session?.user as { id: string; role?: string } | undefined;
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (user.role !== "admin" && user.role !== "superadmin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!adminDriveOAuthConfigured()) {
    return NextResponse.json({ error: "Google OAuth not configured" }, { status: 503 });
  }
  return NextResponse.redirect(buildAdminDriveOAuthUrl(signAdminState(user.id)));
}
