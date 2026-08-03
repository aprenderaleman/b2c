import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveCloserActor } from "@/lib/closer-auth";
import { supabaseAdmin } from "@/lib/supabase";
import { processActionResult } from "@/lib/closer-action-flow";

/**
 * POST /api/closer/leads/[id]/registrar — registrar un resultado sobre
 * el lead SIN tarea asociada (ej. lead que respondió, enlace sin pagar).
 * Mismo flujo que completar tarea: chips, motivos, derivación de estado.
 */
const Body = z.object({
  resultado: z.enum(["contactado", "no_contesto", "buzon", "no_interesado", "reagendado", "venta"]),
  notas: z.string().max(1000).optional(),
  objectionChip: z.enum(["precio", "pensarlo", "pareja", "tiempo", "otra"]).optional(),
  motivoNoInteresado: z.string().max(500).optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = await resolveCloserActor();
  if (!actor) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const closerId = actor.id;
  const { id: leadId } = await params;

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
    .select("id, closer_id")
    .eq("id", leadId)
    .single();

  if (!lead) return NextResponse.json({ error: "lead_not_found" }, { status: 404 });
  if (lead.closer_id !== closerId) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  try {
    await processActionResult({
      taskId: null,
      closerId,
      leadId,
      resultado: parsed.data.resultado,
      objectionChip: parsed.data.objectionChip ?? null,
      motivoNoInteresado: parsed.data.motivoNoInteresado ?? null,
      nota: parsed.data.notas ?? null,
    });
  } catch (err) {
    console.error("[closer/leads/registrar] processActionResult error:", err);
    return NextResponse.json({ error: "process_failed" }, { status: 500 });
  }

  const { count } = await sb
    .from("tareas_closer")
    .select("id", { count: "exact", head: true })
    .eq("lead_id", leadId)
    .is("fecha_completada", null);

  return NextResponse.json({ ok: true, remainingTasks: count ?? 0 });
}
