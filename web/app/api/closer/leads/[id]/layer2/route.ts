import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { processLayer2Action } from "@/lib/closer-layer2-actions";

const Body = z.object({
  action: z.enum([
    "agendar", "no_contesto", "enviar_info", "enviar_propuesta",
    "seguimiento_fecha", "enviar_enlace", "confirmar_pago", "pasar_reactivacion",
  ]),
  ritmoId: z.enum(["viajero", "estandar", "intensivo", "vip_express"]).optional(),
  goalId: z.string().optional(),
  fecha: z.string().optional(),
  nota: z.string().max(1000).optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const role = (session.user as { role?: string }).role;
  if (role !== "closer") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const closerId = session.user.id;
  const { id: leadId } = await params;

  const sb = supabaseAdmin();
  const { data: lead } = await sb
    .from("leads")
    .select("closer_id")
    .eq("id", leadId)
    .single();

  if (!lead || (lead as { closer_id: string | null }).closer_id !== closerId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let rawBody: unknown;
  try { rawBody = await req.json(); }
  catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }

  const parsed = Body.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed", details: parsed.error.flatten() }, { status: 400 });
  }

  const result = await processLayer2Action({
    closerId,
    leadId,
    action: parsed.data.action,
    ritmoId: parsed.data.ritmoId as "viajero" | "estandar" | "intensivo" | "vip_express" | undefined,
    goalId: parsed.data.goalId,
    fecha: parsed.data.fecha,
    nota: parsed.data.nota,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json(result);
}
