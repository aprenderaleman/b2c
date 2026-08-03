import { NextResponse } from "next/server";
import { resolveCloserActor } from "@/lib/closer-auth";
import { getCloserLeads } from "@/lib/closer-actions";

export async function GET(req: Request) {
  const actor = await resolveCloserActor();
  if (!actor) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const closerId = actor.id;
  const url = new URL(req.url);
  const estadoCierre = url.searchParams.get("estado") ?? undefined;

  const leads = await getCloserLeads(closerId, estadoCierre);
  return NextResponse.json({ leads });
}
