import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

const Body = z.object({
  motivo: z.string().trim().min(1).max(500),
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

  const { id: ventaId } = await params;
  const adminId = (session.user as { id: string }).id;
  const sb = supabaseAdmin();

  const { data: venta } = await sb
    .from("ventas")
    .select("lead_id")
    .eq("id", ventaId)
    .eq("estado", "pendiente")
    .single();

  if (!venta) {
    return NextResponse.json({ error: "venta_not_found_or_not_pending" }, { status: 404 });
  }

  let rawBody: unknown;
  try { rawBody = await req.json(); }
  catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }

  const parsed = Body.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed", details: parsed.error.flatten() }, { status: 400 });
  }

  await sb
    .from("ventas")
    .update({
      estado: "rechazada",
      aprobado_por: adminId,
      aprobado_at: new Date().toISOString(),
      motivo_rechazo: parsed.data.motivo,
    })
    .eq("id", ventaId);

  await sb
    .from("leads")
    .update({ estado_cierre: "en_seguimiento" })
    .eq("id", venta.lead_id);

  await sb.from("lead_timeline").insert({
    lead_id: venta.lead_id,
    type: "status_change",
    author: "admin",
    content: `Venta rechazada: ${parsed.data.motivo}`,
    metadata: { kind: "sale_rejected", venta_id: ventaId },
  });

  return NextResponse.json({ ok: true });
}
