import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { adminDriveStatus } from "@/lib/admin-google-drive";

export async function GET() {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (role !== "admin" && role !== "superadmin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  return NextResponse.json(await adminDriveStatus());
}
