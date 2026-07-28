import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { logCloserAction } from "@/lib/closer-actions";

const Body = z.object({
  tipo: z.enum(["llamada", "whatsapp", "email", "nota", "otro"]),
  contenido: z.string().max(2000).optional(),
  resultado: z.string().max(500).optional(),
  duracionSeg: z.number().int().min(0).optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const role = (session.user as { role?: string }).role;
  if (role !== "closer") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { id: leadId } = await params;
  const closerId = (session.user as { id: string }).id;

  let rawBody: unknown;
  try { rawBody = await req.json(); }
  catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }

  const parsed = Body.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed", details: parsed.error.flatten() }, { status: 400 });
  }

  const accionId = await logCloserAction({
    closerId,
    leadId,
    ...parsed.data,
  });

  return NextResponse.json({ ok: true, accionId });
}
