import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveCloserActor } from "@/lib/closer-auth";
import { replaceCloserAvailability, type AvailabilityDraft } from "@/lib/availability";

/**
 * PUT /api/closer/availability
 *
 * Reemplaza el set de disponibilidad semanal del closer (mismo contrato
 * que /api/teacher/availability). Acepta al closer y al admin
 * impersonando ("Ver como closer") vía resolveCloserActor.
 */

const Body = z.object({
  blocks: z.array(z.object({
    day_of_week: z.number().int().min(0).max(6),
    start_time:  z.string().regex(/^\d{2}:\d{2}$/, "HH:MM"),
    end_time:    z.string().regex(/^\d{2}:\d{2}$/, "HH:MM"),
    available:   z.boolean().default(true),
  })).max(50),
});

export async function PUT(req: Request) {
  const actor = await resolveCloserActor();
  if (!actor) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  let rawBody: unknown;
  try { rawBody = await req.json(); }
  catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }

  const parsed = Body.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed", details: parsed.error.flatten() }, { status: 400 });
  }

  for (const b of parsed.data.blocks) {
    if (b.end_time <= b.start_time) {
      return NextResponse.json(
        { error: "validation_failed", message: `Bloque inválido: ${b.start_time}–${b.end_time} (la hora fin debe ser mayor).` },
        { status: 400 },
      );
    }
  }

  const draft: AvailabilityDraft = parsed.data.blocks.map(b => ({
    day_of_week: b.day_of_week,
    start_time:  b.start_time + ":00",
    end_time:    b.end_time   + ":00",
    available:   b.available,
  }));

  try {
    await replaceCloserAvailability(actor.id, draft);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: "save_failed", message: e instanceof Error ? e.message : "unknown" },
      { status: 500 },
    );
  }
}
