import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase";
import {
  createInfoCallEvent,
  getCalendarBusy,
  googleCalendarConfigured,
} from "@/lib/google-calendar";

/**
 * POST /api/internal/info-call/book
 *
 * Agenda una llamada informativa de 15 min con Gelfis para un lead
 * que respondió al primer mensaje del drip de followups proponiendo
 * una hora. La llama agent_4 (`_handle_call_time_proposal`) tras
 * parsear la hora del mensaje del lead.
 *
 * Lógica:
 *   1. Carga el lead.
 *   2. freeBusy en el calendar de Gelfis para [start, start+duration].
 *      Si hay solapamiento → 409 { error: "busy" }.
 *   3. Inserta el evento en el calendar.
 *   4. Cambia status del lead a 'in_conversation' (pasa de drip a
 *      conversación con Stiv/Gelfis) y registra timeline.
 *
 * Body: { lead_id, start_iso, duration_minutes? = 15 }
 * Auth: Authorization: Bearer <CRON_SECRET> (reusamos el secret —
 *       este endpoint solo lo llaman los agentes Python desde el VPS).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorised(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const bearer = req.headers.get("authorization");
  if (bearer && bearer.toLowerCase().startsWith("bearer ")) {
    if (bearer.slice(7).trim() === expected) return true;
  }
  return req.headers.get("x-cron-secret") === expected;
}

const BodySchema = z.object({
  lead_id:          z.string().trim().uuid(),
  start_iso:        z.string().trim().min(10).max(40),
  duration_minutes: z.number().int().min(5).max(120).optional().default(15),
});

export async function POST(req: NextRequest) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "cron_not_configured" }, { status: 503 });
  }
  if (!authorised(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!googleCalendarConfigured()) {
    return NextResponse.json({ error: "calendar_not_configured" }, { status: 503 });
  }

  let body: unknown;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const { lead_id, start_iso, duration_minutes } = parsed.data;

  // Parse + validate la fecha.
  const start = new Date(start_iso);
  if (Number.isNaN(start.getTime())) {
    return NextResponse.json({ error: "bad_start_iso" }, { status: 400 });
  }
  const end = new Date(start.getTime() + duration_minutes * 60_000);

  // Sanity check: el slot debe estar entre ahora-5min y +14 días.
  const now = Date.now();
  if (start.getTime() < now - 5 * 60_000) {
    return NextResponse.json({ error: "in_the_past" }, { status: 400 });
  }
  if (start.getTime() > now + 14 * 24 * 3600_000) {
    return NextResponse.json({ error: "too_far_in_future" }, { status: 400 });
  }

  const sb = supabaseAdmin();
  const { data: lead, error: leadErr } = await sb
    .from("leads")
    .select("id, name, email, whatsapp_normalized, german_level, goal, motivo_inicial, status")
    .eq("id", lead_id)
    .maybeSingle();
  if (leadErr || !lead) {
    return NextResponse.json({ error: "lead_not_found" }, { status: 404 });
  }
  const l = lead as {
    id: string; name: string; email: string | null; whatsapp_normalized: string | null;
    german_level: string | null; goal: string | null; motivo_inicial: string | null;
    status: string;
  };

  // 1) freeBusy — ¿está libre la franja?
  const busy = await getCalendarBusy(
    new Date(start.getTime() - 60_000).toISOString(),         // 1 min de buffer antes
    new Date(end.getTime()   + 60_000).toISOString(),
  );
  const overlap = busy.find(b =>
    b.startMs < end.getTime() && b.endMs > start.getTime()
  );
  if (overlap) {
    return NextResponse.json(
      {
        error: "busy",
        message: "El calendario ya tiene un evento en esa franja.",
        busy_from: new Date(overlap.startMs).toISOString(),
        busy_to:   new Date(overlap.endMs).toISOString(),
      },
      { status: 409 },
    );
  }

  // 2) Crear el evento
  const created = await createInfoCallEvent({
    leadName:        l.name,
    startIso:        start.toISOString(),
    durationMinutes: duration_minutes,
    leadEmail:       l.email,
    leadWhatsapp:    l.whatsapp_normalized,
    germanLevel:     l.german_level,
    goal:            l.goal,
    motivoInicial:   l.motivo_inicial,
  });
  if (!created) {
    return NextResponse.json({ error: "calendar_insert_failed" }, { status: 502 });
  }

  // 3) Avanzar el lead a 'in_conversation' (sale del drip cron — ese cron
  //    filtra por status='registered') y registrar timeline.
  if (l.status === "registered") {
    await sb.from("leads")
      .update({ status: "in_conversation", updated_at: new Date().toISOString() })
      .eq("id", l.id);
  }
  await sb.from("lead_timeline").insert({
    lead_id: l.id,
    type:    "calendly_event",  // tipo existente más cercano semánticamente
    author:  "agent_4",
    content: `📞 Llamada informativa de ${duration_minutes} min agendada con Gelfis para ${start.toLocaleString("es-ES", { timeZone: "Europe/Berlin", dateStyle: "full", timeStyle: "short" })}`,
    metadata: {
      kind:             "info_call_booked",
      event_id:         created.eventId,
      event_link:       created.htmlLink,
      start_iso:        start.toISOString(),
      duration_minutes,
    },
  });

  return NextResponse.json(
    {
      ok:        true,
      event_id:  created.eventId,
      event_link: created.htmlLink,
      start_iso: start.toISOString(),
      end_iso:   end.toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
