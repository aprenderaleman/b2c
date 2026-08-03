import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveCloserActor } from "@/lib/closer-auth";
import { supabaseAdmin } from "@/lib/supabase";
import { processLayer2Action, resolveMessageForCloser } from "@/lib/closer-layer2-actions";

const TEMPLATE_KIND: Record<string, string> = {
  no_contesto: "chain8b_no_contesto",
  enviar_info: "chain8c_info",
  pasar_reactivacion: "chain8g_reactivacion",
  enviar_propuesta: "chain8d_propuesta",
};

const Body = z.object({
  action: z.enum([
    "agendar", "no_contesto", "enviar_info", "enviar_propuesta",
    "seguimiento_fecha", "enviar_enlace", "confirmar_pago", "pasar_reactivacion",
  ]),
  preview: z.boolean().optional(),
  ritmoId: z.enum(["viajero", "estandar", "intensivo", "vip_express"]).optional(),
  goalId: z.string().optional(),
  fecha: z.string().optional(),
  nota: z.string().max(1000).optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = await resolveCloserActor();
  if (!actor) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const closerId = actor.id;
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

  if (parsed.data.preview) {
    const kind = TEMPLATE_KIND[parsed.data.action];
    if (!kind) return NextResponse.json({ ok: true, message: null });

    const extraMeta: Record<string, unknown> = {};
    if (parsed.data.ritmoId) {
      const { RITMOS } = await import("@/lib/trial-packs");
      const ritmo = RITMOS.find(r => r.id === parsed.data.ritmoId);
      if (ritmo) {
        extraMeta.ritmo = `${ritmo.emoji} ${ritmo.name}`;
        extraMeta.precio_ritmo = `${ritmo.pricePerMonth} €/mes`;
        extraMeta.packId = ritmo.id;
      }
    }

    const message = await resolveMessageForCloser(leadId, kind, 1, extraMeta);
    return NextResponse.json({ ok: true, message });
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
