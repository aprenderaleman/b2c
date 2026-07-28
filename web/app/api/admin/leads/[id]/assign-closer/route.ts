import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { assignCloser } from "@/lib/closer-actions";

const Body = z.object({
  closerId: z.string().uuid(),
  tipo: z.enum(["tipo_a", "tipo_b"]),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const role = (session.user as { role?: string }).role;
  if (role !== "superadmin" && role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id: leadId } = await params;

  let rawBody: unknown;
  try { rawBody = await req.json(); }
  catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }

  const parsed = Body.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed", details: parsed.error.flatten() }, { status: 400 });
  }

  const tasksCreated = await assignCloser(leadId, parsed.data.closerId, parsed.data.tipo);

  return NextResponse.json({ ok: true, tasksCreated });
}
