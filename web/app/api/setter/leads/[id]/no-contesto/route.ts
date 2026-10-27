import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase";
import { resolveSetterActor } from "@/lib/setter-auth";
import { registerContact } from "@/lib/contacts";
import { sendSetterNoContestoMessage } from "@/lib/setter-messages";

/**
 * POST /api/setter/leads/[id]/no-contesto — botón "No contestó" (Gelfis
 * 2026-10-26). Registra el intento (el lead baja de la lista y vuelve a
 * las 24h o 2h antes de su clase) y, si tiene cita futura, Stiv le
 * escribe por WhatsApp de parte del setter pidiendo el confirmo.
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
    .from("leads").select("id, status, estado_cierre").eq("id", leadId).maybeSingle();
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

  // 1) El intento queda registrado — activa el snooze de la cola.
  const contact = await registerContact({
    leadId,
    actor: { type: "setter", id: setter.id, name: setter.name },
    actionType: "no_contesto",
    channel: "llamada",
    note: parsed.data.note,
  });
  if (!contact.ok) {
    const status = contact.error === "db_error" ? 500 : 400;
    return NextResponse.json({ ok: false, error: contact.error }, { status });
  }

  // 2) Stiv le escribe por WA: pide el confirmo (cita futura) o le
  //    envía el enlace de reagenda (no-show).
  const send = await sendSetterNoContestoMessage(leadId, setter.name);

  return NextResponse.json({
    ok: true,
    wa_sent: send.waSent,
    variant: send.variant ?? null,
    send_reason: send.ok ? null : send.reason ?? null,
  });
}
