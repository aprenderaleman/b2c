import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { listCostesFijos, createCosteFijo } from "@/lib/empresa";

const CreateBody = z.object({
  name: z.string().min(1).max(200),
  category: z.enum(["hosting", "herramientas", "profesores", "ads", "otros"]),
  amount_cents: z.number().int().positive(),
  notes: z.string().max(500).optional(),
  starts_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  ends_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const role = (session.user as { role?: string }).role;
  if (role !== "admin" && role !== "superadmin")
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const data = await listCostesFijos();
  return NextResponse.json({ data });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const role = (session.user as { role?: string }).role;
  if (role !== "admin" && role !== "superadmin")
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  let raw: unknown;
  try { raw = await req.json(); }
  catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }

  const parsed = CreateBody.safeParse(raw);
  if (!parsed.success)
    return NextResponse.json({ error: "validation_failed", details: parsed.error.flatten() }, { status: 400 });

  const data = await createCosteFijo(parsed.data);
  return NextResponse.json({ data }, { status: 201 });
}
