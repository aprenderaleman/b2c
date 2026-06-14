import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { updateCosteFijo, deleteCosteFijo } from "@/lib/empresa";

const UpdateBody = z.object({
  name: z.string().min(1).max(200).optional(),
  category: z.enum(["hosting", "herramientas", "profesores", "ads", "otros"]).optional(),
  amount_cents: z.number().int().positive().optional(),
  active: z.boolean().optional(),
  notes: z.string().max(500).nullable().optional(),
  starts_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  ends_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const role = (session.user as { role?: string }).role;
  if (role !== "admin" && role !== "superadmin")
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { id } = await params;

  let raw: unknown;
  try { raw = await req.json(); }
  catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }

  const parsed = UpdateBody.safeParse(raw);
  if (!parsed.success)
    return NextResponse.json({ error: "validation_failed", details: parsed.error.flatten() }, { status: 400 });

  try {
    const data = await updateCosteFijo(id, parsed.data);
    return NextResponse.json({ data });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 404 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const role = (session.user as { role?: string }).role;
  if (role !== "admin" && role !== "superadmin")
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { id } = await params;

  try {
    await deleteCosteFijo(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 404 });
  }
}
