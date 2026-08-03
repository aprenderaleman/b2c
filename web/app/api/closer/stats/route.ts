import { NextResponse } from "next/server";
import { resolveCloserActor } from "@/lib/closer-auth";
import { getCloserStats } from "@/lib/closer-commissions";

export async function GET() {
  const actor = await resolveCloserActor();
  if (!actor) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const closerId = actor.id;
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

  const stats = await getCloserStats(closerId, monthStart, monthEnd);
  return NextResponse.json(stats);
}
