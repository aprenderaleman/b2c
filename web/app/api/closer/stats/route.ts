import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getCloserStats } from "@/lib/closer-commissions";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const role = (session.user as { role?: string }).role;
  if (role !== "closer") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const closerId = (session.user as { id: string }).id;
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

  const stats = await getCloserStats(closerId, monthStart, monthEnd);
  return NextResponse.json(stats);
}
