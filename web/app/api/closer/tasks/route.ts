import { NextResponse } from "next/server";
import { resolveCloserActor } from "@/lib/closer-auth";
import { getCloserTasks, type TaskFilter } from "@/lib/closer-cadence";

export async function GET(req: Request) {
  const actor = await resolveCloserActor();
  if (!actor) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const closerId = actor.id;
  const url = new URL(req.url);
  const filter = (url.searchParams.get("filter") ?? "hoy") as TaskFilter;

  const tasks = await getCloserTasks(closerId, filter);
  return NextResponse.json({ tasks });
}
