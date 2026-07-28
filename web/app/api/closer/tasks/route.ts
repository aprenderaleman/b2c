import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getCloserTasks, type TaskFilter } from "@/lib/closer-cadence";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const role = (session.user as { role?: string }).role;
  if (role !== "closer") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const closerId = (session.user as { id: string }).id;
  const url = new URL(req.url);
  const filter = (url.searchParams.get("filter") ?? "hoy") as TaskFilter;

  const tasks = await getCloserTasks(closerId, filter);
  return NextResponse.json({ tasks });
}
