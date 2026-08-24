import { NextResponse } from "next/server";
import { resolveCloserActor } from "@/lib/closer-auth";
import { supabaseAdmin } from "@/lib/supabase";
import { getCloserAvailability } from "@/lib/availability";

/**
 * GET /api/closer/calendar?start=ISO&end=ISO
 *
 * Sesiones de plan del closer dentro de la ventana + su disponibilidad
 * semanal. Mismo contrato que /api/teacher/calendar para que el
 * WeekCalendar sea compartido.
 */

export const runtime = "nodejs";

export async function GET(req: Request) {
  const actor = await resolveCloserActor();
  if (!actor) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const start = url.searchParams.get("start");
  const end   = url.searchParams.get("end");
  if (!start || !end || isNaN(Date.parse(start)) || isNaN(Date.parse(end))) {
    return NextResponse.json({ error: "start_end_required" }, { status: 400 });
  }

  const sb = supabaseAdmin();
  const { data: rows, error } = await sb
    .from("classes")
    .select(`
      id, title, type, status, scheduled_at, duration_minutes, is_trial, lead_id,
      lead:leads(id, name, whatsapp_normalized)
    `)
    .eq("sesion_closer_id", actor.id)
    .gte("scheduled_at", start)
    .lt("scheduled_at", end)
    .neq("status", "cancelled")
    .is("deleted_at", null)
    .order("scheduled_at", { ascending: true });
  if (error) {
    return NextResponse.json({ error: "query_failed", message: error.message }, { status: 500 });
  }

  type LeadJoin = { id: string; name: string | null; whatsapp_normalized: string | null };
  type Row = {
    id: string; title: string; type: string; status: string;
    scheduled_at: string; duration_minutes: number | null; is_trial: boolean;
    lead_id: string | null;
    lead: LeadJoin | LeadJoin[] | null;
  };

  const events = ((rows ?? []) as Row[]).map(r => {
    const l = Array.isArray(r.lead) ? r.lead[0] ?? null : r.lead;
    return {
      id:               r.id,
      title:            l?.name ? `Sesión de plan — ${l.name}` : (r.title || "Sesión de plan"),
      type:             "sesion",
      status:           r.status,
      scheduled_at:     r.scheduled_at,
      duration_minutes: r.duration_minutes ?? 20,
      is_trial:         false,
      is_recurring:     false,
      parent_class_id:  null,
      recurrence_pattern: null,
      participants:     [] as Array<{ studentId: string; name: string; whatsapp: string | null }>,
      lead: l ? { id: l.id, name: l.name, whatsapp: l.whatsapp_normalized } : null,
    };
  });

  const availability = await getCloserAvailability(actor.id).catch(() => []);

  return NextResponse.json({
    events,
    availability: availability
      .filter(b => b.available)
      .map(b => ({ day_of_week: b.day_of_week, start_time: b.start_time, end_time: b.end_time })),
  });
}
