import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveCloserActor } from "@/lib/closer-auth";
import { supabaseAdmin } from "@/lib/supabase";
import { startChain } from "@/lib/chain-engine";
import { registerContact } from "@/lib/contacts";

/**
 * POST /api/closer/leads/[id]/sesion-resultado — el closer marca el
 * resultado de la Sesión de Plan (Gelfis 2026-08-14).
 *
 *  asistio    → trial_attended_at + cadena sesion_attended
 *               (T+2h / +24h / +3d / +7d, sin {profe}, cierre → en_reactivacion)
 *  no_asistio → trial_absent_at + cadena sesion_absent
 *               (T+20min / +24h / +3d, reagenda → /sesion-plan)
 *
 * Alimenta los filtros Asistió/No asistió y la tasa de cierre del
 * closer. startChain cancela cualquier cadena activa previa.
 */
const Body = z.object({
  resultado: z.enum(["asistio", "no_asistio"]),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = await resolveCloserActor();
  if (!actor) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { id: leadId } = await params;

  let raw: unknown;
  try { raw = await req.json(); }
  catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }

  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed" }, { status: 400 });
  }

  const sb = supabaseAdmin();
  const { data: lead } = await sb
    .from("leads")
    .select("id, closer_id, sesion_plan_at, name")
    .eq("id", leadId)
    .single();

  if (!lead) return NextResponse.json({ error: "lead_not_found" }, { status: 404 });
  if (lead.closer_id !== actor.id) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!lead.sesion_plan_at) return NextResponse.json({ error: "sin_sesion" }, { status: 400 });

  const asistio = parsed.data.resultado === "asistio";
  const now = new Date().toISOString();

  await sb.from("leads").update(
    asistio
      ? { trial_attended_at: now, trial_absent_at: null }
      : { trial_absent_at: now },
  ).eq("id", leadId);

  // Registrar el resultado COMPLETA la tarea de la sesión (si no, la
  // tarea "vence hoy" mantiene al lead en amarillo A1 aunque el closer
  // ya haya actuado — caso Alicia 2026-08-17).
  await sb
    .from("tareas_closer")
    .update({
      fecha_completada: now,
      resultado: "contactado",
      notas: asistio ? "Sesión de Plan: asistió" : "Sesión de Plan: no asistió",
    })
    .eq("lead_id", leadId)
    .eq("tipo", "sesion_plan")
    .is("fecha_completada", null);

  const chainId = await startChain(leadId, asistio ? "sesion_attended" : "sesion_absent", {})
    .catch(() => null);

  await sb.from("lead_timeline").insert({
    lead_id: leadId,
    type: "status_change",
    author: "closer",
    content: asistio
      ? `📋 Sesión de Plan: ASISTIÓ (marcado por ${actor.name}). Cadena de seguimiento iniciada.`
      : `📋 Sesión de Plan: NO ASISTIÓ (marcado por ${actor.name}). Cadena de rescate iniciada (primer mensaje en ~20 min).`,
    metadata: {
      kind: asistio ? "sesion_attended_marked" : "sesion_absent_marked",
      closer_id: actor.id,
      chain_id: chainId,
    },
  });

  await registerContact({
    leadId,
    actor: { type: "closer", id: actor.id, name: actor.name },
    actionType: asistio ? "asistio" : "no_show",
    channel: "aula",
    note: "Sesión de Plan",
  });

  return NextResponse.json({ ok: true, chainStarted: !!chainId });
}
