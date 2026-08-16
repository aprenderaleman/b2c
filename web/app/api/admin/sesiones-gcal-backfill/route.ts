import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { buildTrialToken, buildLeadJoinUrl } from "@/lib/trial-token";
import { createSesionEventForCloser } from "@/lib/closer-calendar-sync";
import { SESION_MINUTES } from "@/lib/sesion-slots";

/**
 * POST /api/admin/sesiones-gcal-backfill
 *
 * One-shot admin: crea el evento en el Google Calendar del closer para
 * TODAS las Sesiones de Plan futuras (status=scheduled) que aún no tienen
 * closer_gcal_event_id. Idempotente — se puede ejecutar varias veces sin
 * duplicar eventos ya creados en corridas anteriores.
 *
 * Necesario tras vincular calendar por primera vez o después de deploy de
 * la integración (Gelfis 2026-08-16).
 */

const PLATFORM_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://b2c.aprender-aleman.de").replace(/\/$/, "");

export async function POST(req: Request) {
  // Aceptamos dos formas de auth: sesión admin (desde DevTools del navegador)
  // o CRON_SECRET (script). El endpoint es idempotente — segura la doble vía.
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  const cronOk = Boolean(process.env.CRON_SECRET) && bearer === process.env.CRON_SECRET;
  if (!cronOk) {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const user = session.user as { id: string; role?: string };
    if (!user.role || !["admin", "superadmin"].includes(user.role)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  }

  const sb = supabaseAdmin();
  const nowIso = new Date().toISOString();

  // Sesiones futuras con closer asignado, sin evento aún.
  const { data: rows, error } = await sb
    .from("classes")
    .select("id, scheduled_at, duration_minutes, short_code, sesion_closer_id, lead_id, closer_gcal_event_id")
    .not("sesion_closer_id", "is", null)
    .is("closer_gcal_event_id", null)
    .eq("status", "scheduled")
    .is("deleted_at", null)
    .gte("scheduled_at", nowIso)
    .order("scheduled_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: "db_query_failed", details: error.message }, { status: 500 });
  }

  const results = { total: (rows ?? []).length, created: 0, skipped: 0, failed: 0, details: [] as unknown[] };

  for (const c of (rows ?? []) as Array<{
    id: string;
    scheduled_at: string;
    duration_minutes: number | null;
    short_code: string | null;
    sesion_closer_id: string;
    lead_id: string;
    closer_gcal_event_id: string | null;
  }>) {
    const { data: lead } = await sb
      .from("leads")
      .select("name, email, whatsapp_normalized, german_level, goal, qualification_answers")
      .eq("id", c.lead_id)
      .maybeSingle();
    if (!lead) {
      results.skipped++;
      results.details.push({ classId: c.id, reason: "lead_not_found" });
      continue;
    }
    const leadRow = lead as {
      name: string;
      email: string | null;
      whatsapp_normalized: string | null;
      german_level: string | null;
      goal: string | null;
      qualification_answers: { goal?: string; level?: string; deadline?: string } | null;
    };

    const token = buildTrialToken(c.lead_id, c.id);
    const joinUrl = buildLeadJoinUrl({
      classId:   c.id,
      leadId:    c.lead_id,
      shortCode: c.short_code,
      baseUrl:   PLATFORM_URL,
    });
    const confirmacionUrl = `${PLATFORM_URL}/confirmacion?c=${c.id}&t=${encodeURIComponent(token)}`;

    try {
      const eventId = await createSesionEventForCloser(c.sesion_closer_id, {
        leadName:        leadRow.name,
        startIso:        c.scheduled_at,
        durationMinutes: c.duration_minutes ?? SESION_MINUTES,
        leadEmail:       leadRow.email,
        leadWhatsapp:    leadRow.whatsapp_normalized,
        germanLevel:     leadRow.qualification_answers?.level ?? leadRow.german_level,
        goal:            leadRow.qualification_answers?.goal ?? leadRow.goal,
        deadline:        leadRow.qualification_answers?.deadline ?? null,
        joinUrl,
        confirmacionUrl,
      });
      if (eventId) {
        await sb.from("classes")
          .update({ closer_gcal_event_id: eventId })
          .eq("id", c.id);
        results.created++;
        results.details.push({ classId: c.id, eventId, closerId: c.sesion_closer_id });
      } else {
        results.skipped++;
        results.details.push({ classId: c.id, reason: "closer_calendar_not_linked", closerId: c.sesion_closer_id });
      }
    } catch (e) {
      results.failed++;
      results.details.push({
        classId: c.id,
        reason: "exception",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return NextResponse.json({ ok: true, ...results });
}
