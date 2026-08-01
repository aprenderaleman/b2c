import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { triggerReactivationBatch } from "@/lib/closer-reactivation";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const role = (session.user as { role?: string }).role;
  if (role !== "superadmin" && role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: { closer_id?: string; max_leads?: number; days_back?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!body.closer_id) {
    return NextResponse.json({ error: "closer_id_required" }, { status: 400 });
  }

  const result = await triggerReactivationBatch(body.closer_id, {
    maxLeads: body.max_leads,
    daysBack: body.days_back,
  });

  return NextResponse.json(result);
}
