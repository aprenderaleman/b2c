import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { createAdminNotification } from "@/lib/admin-notifications";

const Body = z.object({
  packId: z.string().min(1),
  paymentType: z.enum(["single", "flexible", "extended"]),
  montoCents: z.number().int().min(0),
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

  const sb = supabaseAdmin();

  const { data: lead } = await sb
    .from("leads")
    .select("id, full_name, closer_id")
    .eq("id", leadId)
    .single();

  if (!lead) return NextResponse.json({ error: "lead_not_found" }, { status: 404 });
  if (lead.closer_id !== closerId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { data: existing } = await sb
    .from("ventas")
    .select("id")
    .eq("lead_id", leadId)
    .eq("estado", "pendiente")
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ error: "ya_tiene_venta_pendiente" }, { status: 409 });
  }

  const { data: venta, error } = await sb
    .from("ventas")
    .insert({
      lead_id: leadId,
      solicitado_por: closerId,
      rol_solicitante: "closer",
      pack_id: parsed.data.packId,
      payment_type: parsed.data.paymentType,
      monto_cents: parsed.data.montoCents,
    })
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ error: "insert_failed", message: error.message }, { status: 500 });
  }

  await sb
    .from("leads")
    .update({ estado_cierre: "venta_pendiente" })
    .eq("id", leadId);

  await sb.from("lead_timeline").insert({
    lead_id: leadId,
    type: "agent_note",
    author: "closer",
    content: `Venta marcada (pack: ${parsed.data.packId}, ${parsed.data.paymentType}). Pendiente de aprobacion.`,
    metadata: {
      kind: "sale_marked",
      venta_id: venta.id,
      closer_id: closerId,
      pack_id: parsed.data.packId,
    },
  });

  const closerName = (session.user as { name?: string }).name ?? "Closer";
  await createAdminNotification({
    type: "venta_pendiente",
    severity: "warning",
    title: "Venta pendiente de aprobacion",
    body: `${closerName} marco venta para ${lead.full_name ?? "lead"} (pack ${parsed.data.packId})`,
    lead_id: leadId,
    action_url: `/admin/aprobaciones`,
  });

  return NextResponse.json({ ok: true, ventaId: venta.id });
}
