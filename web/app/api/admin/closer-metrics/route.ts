import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getSpeedToLead, getChainFunnel } from "@/lib/closer-metrics";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const role = (session.user as { role?: string }).role;
  if (role !== "superadmin" && role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const days = parseInt(searchParams.get("days") ?? "30", 10);
  const now = new Date();
  const desde = new Date(now.getTime() - days * 86_400_000);

  const [speedToLead, chainFunnel] = await Promise.all([
    getSpeedToLead(desde, now),
    getChainFunnel(desde, now),
  ]);

  return NextResponse.json({ speedToLead, chainFunnel });
}
