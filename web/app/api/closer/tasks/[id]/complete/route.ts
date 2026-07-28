import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { completeTask } from "@/lib/closer-cadence";

const Body = z.object({
  resultado: z.enum(["contactado", "no_contesto", "no_interesado", "reagendado", "venta"]),
  notas: z.string().max(1000).optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const role = (session.user as { role?: string }).role;
  if (role !== "closer") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { id } = await params;

  let rawBody: unknown;
  try { rawBody = await req.json(); }
  catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }

  const parsed = Body.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed", details: parsed.error.flatten() }, { status: 400 });
  }

  await completeTask(id, parsed.data.resultado, parsed.data.notas);

  return NextResponse.json({ ok: true });
}
