import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { createTrialEvent } from "@/lib/google-calendar";

/**
 * POST /api/admin/classes/[id]/gcal-create
 *
 * Recovery endpoint para clases que tienen `google_calendar_event_id`
 * NULL — situación que ocurre cuando la API de Google Calendar fallaba
 * en book-trial y el flujo silenciaba el error. Caso real Alice Redfern
 * 2026-05-08: clase reservada el 28-abr pero sin evento espejo, así
 * que Gelfis no la veía en su agenda.
 *
 * Idempotente: si la clase ya tiene event_id, devuelve 409 sin tocar.
 *
 * Auth: admin / superadmin.
 */
export const runtime = "nodejs";

const PLATFORM_URL = (process.env.PLATFORM_URL ?? "https://b2c.aprender-aleman.de").replace(/\/$/, "");

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (!session?.user || (role !== "admin" && role !== "superadmin")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const sb = supabaseAdmin();

  // Pull class + lead + teacher
  const { data: cls } = await sb
    .from("classes")
    .select(`
      id, scheduled_at, duration_minutes, google_calendar_event_id, short_code,
      is_trial, lead_id,
      teacher:teachers(users!inner(full_name, email)),
      lead:leads(id, name, email, whatsapp_normalized, german_level, goal)
    `)
    .eq("id", id)
    .maybeSingle();
  if (!cls) return NextResponse.json({ error: "class_not_found" }, { status: 404 });

  type Cls = {
    id: string; scheduled_at: string; duration_minutes: number;
    google_calendar_event_id: string | null; short_code: string;
    is_trial: boolean; lead_id: string | null;
    teacher: { users: { full_name: string | null; email: string } | Array<{ full_name: string | null; email: string }> } |
             Array<{ users: { full_name: string | null; email: string } | Array<{ full_name: string | null; email: string }> }> | null;
    lead: { id: string; name: string | null; email: string | null; whatsapp_normalized: string | null; german_level: string | null; goal: string | null } |
          Array<{ id: string; name: string | null; email: string | null; whatsapp_normalized: string | null; german_level: string | null; goal: string | null }> | null;
  };
  const c = cls as Cls;

  if (c.google_calendar_event_id) {
    return NextResponse.json({
      ok: false, error: "already_has_event",
      event_id: c.google_calendar_event_id,
    }, { status: 409 });
  }

  const flat = <T,>(x: T | T[] | null): T | null => !x ? null : Array.isArray(x) ? (x[0] ?? null) : x;
  const teacherWrap = flat(c.teacher);
  const teacherUser = teacherWrap ? flat(teacherWrap.users) : null;
  const teacherName = teacherUser?.full_name?.trim() || teacherUser?.email || "Stiv";
  const lead = flat(c.lead);
  const leadName = lead?.name ?? "Lead";

  const shortLinkUrl = `${PLATFORM_URL}/c/${c.short_code}`;

  const result = await createTrialEvent({
    leadName,
    teacherName,
    startIso:        c.scheduled_at,
    durationMinutes: c.duration_minutes ?? 30,
    leadEmail:       lead?.email ?? null,
    leadWhatsapp:    lead?.whatsapp_normalized ?? null,
    germanLevel:     lead?.german_level ?? null,
    goal:            lead?.goal ?? null,
    joinUrl:         shortLinkUrl,
  });

  if (!result) {
    return NextResponse.json({
      ok: false, error: "gcal_create_failed",
      reason: "createTrialEvent devolvió null. Revisar GOOGLE_SERVICE_ACCOUNT_JSON / GOOGLE_CALENDAR_ID en Vercel.",
    }, { status: 502 });
  }

  // Persistir el event_id
  await sb.from("classes")
    .update({ google_calendar_event_id: result.eventId })
    .eq("id", id);

  // Audit en timeline si hay lead asociado
  if (c.lead_id) {
    await sb.from("lead_timeline").insert({
      lead_id: c.lead_id,
      type:    "agent_note",
      author:  "gelfis",
      content: `📅 Evento Google Calendar creado RETRO desde admin (${result.eventId.slice(0, 12)}…)`,
      metadata: { kind: "google_calendar_event_recovery", event_id: result.eventId, class_id: id },
    });
  }

  // Si vino de un form (default browser behaviour), redirigimos al lead
  // detail page para que el admin vea la confirmación visual; si vino
  // de un cliente programático (Content-Type JSON), devolvemos JSON.
  const ct = req.headers.get("content-type") ?? "";
  if (!ct.includes("application/json") && c.lead_id) {
    return NextResponse.redirect(new URL(`/admin/leads/${c.lead_id}?gcal=created`, req.url), { status: 303 });
  }
  return NextResponse.json({ ok: true, event_id: result.eventId, html_link: result.htmlLink });
}
