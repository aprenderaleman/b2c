import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase";
import { resolveSetterActor } from "@/lib/setter-auth";
import { registerContact } from "@/lib/contacts";
import { sendSetterAccessMessage } from "@/lib/setter-messages";

/**
 * POST /api/setter/leads/[id]/confirm — botón "Confirmado" (Gelfis
 * 2026-10-26). Registra el CONFIRMO del setter y, acto seguido, el lead
 * recibe por WhatsApp (Stiv) + email: "gracias por confirmar" + enlace
 * para unirse + "Wir sehen uns am {fecha}".
 *
 * El envío es best-effort: el confirmo queda registrado aunque los
 * canales fallen (la UI avisa).
 *
 * Body: { note: string (min 5) }
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  note: z.string().trim().min(5).max(2000),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const setter = await resolveSetterActor();
  if (!setter) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const { id: leadId } = await params;

  let raw: unknown;
  try { raw = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 }); }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "nota_corta" }, { status: 400 });
  }

  const sb = supabaseAdmin();
  const { data: leadRow } = await sb
    .from("leads")
    .select("id, status, estado_cierre")
    .eq("id", leadId)
    .maybeSingle();
  if (!leadRow) return NextResponse.json({ ok: false, error: "lead_not_found" }, { status: 404 });
  const lead = leadRow as { status: string; estado_cierre: string | null };
  if (lead.status === "converted" || lead.estado_cierre === "convertido" ||
      lead.status === "lost" || lead.estado_cierre === "perdido") {
    return NextResponse.json({ ok: false, error: "lead_fuera_de_alcance" }, { status: 409 });
  }
  const { data: cita } = await sb
    .from("classes").select("id").eq("lead_id", leadId).is("deleted_at", null).limit(1);
  if (!cita || cita.length === 0) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  // 1) El confirmo del setter — esto lo saca de su lista de pendientes.
  const contact = await registerContact({
    leadId,
    actor: { type: "setter", id: setter.id, name: setter.name },
    actionType: "confirmar_cita",
    channel: "llamada",
    note: parsed.data.note,
  });
  if (!contact.ok) {
    const status = contact.error === "db_error" ? 500 : 400;
    return NextResponse.json({ ok: false, error: contact.error }, { status });
  }

  // 2) Gracias + enlace + "Wir sehen uns am {fecha}" (WA + email).
  const send = await sendSetterAccessMessage(leadId, "confirmed", setter.name);

  return NextResponse.json({
    ok: true,
    wa_sent: send.waSent,
    email_sent: send.emailSent,
    start_label: send.startLabel,
    send_reason: send.ok ? null : send.reason ?? null,
  });
}
