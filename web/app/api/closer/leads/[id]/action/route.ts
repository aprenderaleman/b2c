import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveCloserActor } from "@/lib/closer-auth";
import { logCloserAction } from "@/lib/closer-actions";
import { parseOccurredAt } from "@/lib/closer-action-flow";
import { ensureFuturePlay } from "@/lib/semaforo";

// Nota obligatoria ≥5 chars en toda acción del closer (CRM Closer F1).
const Body = z.object({
  tipo: z.enum(["llamada", "whatsapp", "email", "nota", "otro"]),
  contenido: z.string().max(2000),
  resultado: z.string().max(500).optional(),
  duracionSeg: z.number().int().min(0).optional(),
  occurredAt: z.string().optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = await resolveCloserActor();
  if (!actor) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { id: leadId } = await params;
  const closerId = actor.id;

  let rawBody: unknown;
  try { rawBody = await req.json(); }
  catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }

  const parsed = Body.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed", details: parsed.error.flatten() }, { status: 400 });
  }
  if (parsed.data.contenido.trim().length < 5) {
    return NextResponse.json({ error: "nota_required" }, { status: 400 });
  }
  const occurred = parseOccurredAt(parsed.data.occurredAt);
  if ("error" in occurred) {
    return NextResponse.json({ error: occurred.error }, { status: 400 });
  }

  const accionId = await logCloserAction({
    closerId,
    leadId,
    tipo: parsed.data.tipo,
    contenido: parsed.data.contenido.trim(),
    resultado: parsed.data.resultado,
    duracionSeg: parsed.data.duracionSeg,
    occurredAt: occurred.iso,
  });

  // Anti-limbo: registrar una nota/contacto ES guardar una acción — si
  // el lead queda sin próxima jugada (p.ej. su cadena se canceló), el
  // sistema le crea la auto-tarea de seguimiento +3d. Sin esto, notas
  // rápidas dejaban al lead sin jugada y en rojo (caso Alicia 2026-08-17).
  await ensureFuturePlay(leadId).catch(() => {});

  return NextResponse.json({ ok: true, accionId });
}
