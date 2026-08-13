import { NextResponse } from "next/server";
import { z } from "zod";
import { after } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { listSesionSlots, SESION_MINUTES } from "@/lib/sesion-slots";
import { buildTrialToken, buildLeadJoinUrl } from "@/lib/trial-token";
import { checkRateLimit, ipFromHeaders } from "@/lib/rate-limit";
import { pauseAllOutbound } from "@/lib/chain-engine";
import { sanitizeE164 } from "@/lib/phone";
import { createAdminNotification } from "@/lib/admin-notifications";
import { notifyCloserOnBooking } from "@/lib/sesion-notifications";

/**
 * POST /api/public/book-sesion-plan — agenda una Sesión de Plan
 * (videollamada de 15 min con un CLOSER) desde el funnel /sesion-plan.
 *
 * Gemelo ligero de book-trial con las reglas de Gelfis 2026-08-13:
 *  (a) lead existente NO se duplica: upsert por email/WhatsApp con
 *      atribución first-touch (solo rellena blancos).
 *  (b) si el lead ya tiene closer asignado, la sesión va a SU closer
 *      (no al del slot); si el horario choca, cae al closer del slot.
 *  (c) agendar sesión PAUSA la cadena automática activa (regla R3:
 *      es una respuesta) hasta 24h después de la sesión.
 *
 * La cita es una fila en `classes` con sesion_closer_id (is_trial=false,
 *  teacher_id=null) + una tarea sesion_plan en la cola HOY del closer.
 * Si el lead no tenía closer, el de la sesión pasa a ser su closer
 * (estado activo, SIN cadencia — la sesión es el siguiente paso).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PLATFORM_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://b2c.aprender-aleman.de").replace(/\/$/, "");

const Body = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(200),
  whatsapp_e164: z.string().trim().max(25).nullable().optional(),
  slot_iso: z.string().datetime(),
  closer_id: z.string().uuid(),
  qualification: z.object({
    goal: z.string().max(40),
    level: z.string().max(40),
    deadline: z.string().max(40),
  }),
  landing_intent: z.string().max(60).default("sesion-plan"),
  gclid: z.string().max(200).nullable().optional(),
  gbraid: z.string().max(200).nullable().optional(),
  wbraid: z.string().max(200).nullable().optional(),
  fbclid: z.string().max(200).nullable().optional(),
  utm_source: z.string().max(120).nullable().optional(),
  utm_medium: z.string().max(120).nullable().optional(),
  utm_campaign: z.string().max(160).nullable().optional(),
  utm_term: z.string().max(160).nullable().optional(),
  utm_content: z.string().max(160).nullable().optional(),
});

// Mapea el nivel del wizard al enum german_level (NOT NULL en leads)
function qualLevelToDbLevel(level: string): string {
  switch (level) {
    case "zero":         return "A0";
    case "basic":        return "A2";
    case "intermediate": return "B1";
    case "advanced":     return "B2";
    default:             return "A0"; // "unknown" — se afina en la sesión
  }
}

// Mapea el goal del wizard al enum lead_goal (mismo criterio que meta-ads-paid)
function qualGoalToDbGoal(goal: string): string {
  switch (goal) {
    case "job":         return "work";
    case "ausbildung":  return "studies";
    case "citizenship": return "visa";
    case "daily_life":  return "already_in_dach";
    case "moving":      return "travel";
    default:            return "travel";
  }
}

export async function POST(req: Request) {
  // ── Rate limit ──
  const ip = ipFromHeaders(req);
  const rl = await checkRateLimit({ scope: "book_sesion", key: ip, max: 5, windowMs: 60 * 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } },
    );
  }

  let raw: unknown;
  try { raw = await req.json(); }
  catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }

  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed", details: parsed.error.flatten() }, { status: 400 });
  }
  const b = parsed.data;
  const whatsapp = b.whatsapp_e164 ? sanitizeE164(b.whatsapp_e164) : null;

  const sb = supabaseAdmin();

  // ── Usuario ya registrado → que entre por login ──
  const { data: existingUser } = await sb
    .from("users").select("id").eq("email", b.email).maybeSingle();
  if (existingUser) {
    return NextResponse.json(
      { error: "already_registered", login_url: `${PLATFORM_URL}/login` },
      { status: 409 },
    );
  }

  // ── (a) Localizar lead existente: sin duplicar, first-touch intacto ──
  const orFilter = whatsapp
    ? `email.eq.${b.email},whatsapp_normalized.eq.${whatsapp}`
    : `email.eq.${b.email}`;
  const { data: found } = await sb
    .from("leads")
    .select("id, name, email, whatsapp_normalized, status, closer_id, motivo_inicial, landing_intent, gclid, gbraid, wbraid, fbclid, utm_source, utm_medium, utm_campaign, utm_term, utm_content, qualification_answers")
    .or(orFilter)
    .order("created_at", { ascending: false })
    .limit(1);

  const existing = (found ?? [])[0] as Record<string, unknown> | undefined;
  let leadId: string;
  let isNewLead = false;

  // Idempotencia: re-submit del MISMO slot → devolver la sesión existente
  // ANTES de revalidar el slot (la propia sesión lo ocupa y ya no se lista).
  if (existing) {
    const { data: same } = await sb
      .from("classes")
      .select("id, short_code")
      .eq("lead_id", existing.id as string)
      .eq("scheduled_at", b.slot_iso)
      .not("sesion_closer_id", "is", null)
      .eq("status", "scheduled")
      .is("deleted_at", null)
      .maybeSingle();
    if (same) {
      const token0 = buildTrialToken(existing.id as string, same.id as string);
      return NextResponse.json({
        ok: true,
        already: true,
        classId: same.id,
        leadId: existing.id,
        token: token0,
        confirmacionUrl: `${PLATFORM_URL}/confirmacion?c=${same.id}&t=${encodeURIComponent(token0)}`,
      });
    }
  }

  // ── Re-validación del slot (mismo patrón que book-trial) ──
  const slots = await listSesionSlots();
  const match = slots.find((s) => s.startIso === b.slot_iso && s.closerId === b.closer_id);
  if (!match) {
    return NextResponse.json({ error: "slot_taken" }, { status: 409 });
  }

  if (existing) {
    leadId = existing.id as string;
    await sb.from("leads").update({
      // Solo rellenar blancos; first-touch manda (igual que book-trial)
      email: (existing.email as string | null) ?? b.email,
      whatsapp_normalized: (existing.whatsapp_normalized as string | null) ?? whatsapp,
      landing_intent: (existing.landing_intent as string | null) ?? b.landing_intent,
      gclid: (existing.gclid as string | null) ?? b.gclid ?? null,
      gbraid: (existing.gbraid as string | null) ?? b.gbraid ?? null,
      wbraid: (existing.wbraid as string | null) ?? b.wbraid ?? null,
      fbclid: (existing.fbclid as string | null) ?? b.fbclid ?? null,
      utm_source: (existing.utm_source as string | null) ?? b.utm_source ?? null,
      utm_medium: (existing.utm_medium as string | null) ?? b.utm_medium ?? null,
      utm_campaign: (existing.utm_campaign as string | null) ?? b.utm_campaign ?? null,
      utm_term: (existing.utm_term as string | null) ?? b.utm_term ?? null,
      utm_content: (existing.utm_content as string | null) ?? b.utm_content ?? null,
      qualification_answers: (existing.qualification_answers as object | null) ?? b.qualification,
      sesion_plan_at: b.slot_iso,
      gdpr_accepted: true,
      gdpr_accepted_at: new Date().toISOString(),
    }).eq("id", leadId);
  } else {
    isNewLead = true;
    const { data: created, error: insErr } = await sb.from("leads").insert({
      name: b.name,
      email: b.email,
      whatsapp_normalized: whatsapp,
      german_level: qualLevelToDbLevel(b.qualification.level),
      goal: qualGoalToDbGoal(b.qualification.goal),
      urgency: "asap",
      language: "es",
      // needs_human: la sesión es atención humana (closer) — Stiv no
      // debe correr funnels de trial sobre este lead.
      status: "needs_human",
      landing_intent: b.landing_intent,
      motivo_inicial: "particulares",
      qualification_answers: b.qualification,
      sesion_plan_at: b.slot_iso,
      gclid: b.gclid ?? null,
      gbraid: b.gbraid ?? null,
      wbraid: b.wbraid ?? null,
      fbclid: b.fbclid ?? null,
      utm_source: b.utm_source ?? null,
      utm_medium: b.utm_medium ?? null,
      utm_campaign: b.utm_campaign ?? null,
      utm_term: b.utm_term ?? null,
      utm_content: b.utm_content ?? null,
      gdpr_accepted: true,
      gdpr_accepted_at: new Date().toISOString(),
      source: "funnel_sesion_plan",
    }).select("id").single();
    if (insErr || !created) {
      console.error("[book-sesion-plan] lead insert failed:", insErr?.message, insErr?.details);
      return NextResponse.json({ error: "lead_create_failed" }, { status: 500 });
    }
    leadId = created.id as string;
  }

  // ── (b) Closer destino: el del lead si ya tiene; si no, el del slot ──
  const leadCloserId = (existing?.closer_id as string | null) ?? null;
  const preferredCloserId = leadCloserId ?? b.closer_id;

  // ── Anti-doble-booking del mismo lead: sesión activa existente ──
  const { data: activeSesion } = await sb
    .from("classes")
    .select("id, scheduled_at, short_code, sesion_closer_id")
    .eq("lead_id", leadId)
    .not("sesion_closer_id", "is", null)
    .eq("status", "scheduled")
    .is("deleted_at", null)
    .gte("scheduled_at", new Date(Date.now() - 3600_000).toISOString())
    .limit(1)
    .maybeSingle();

  let classId: string;
  let shortCode: string | null;
  let rescheduled = false;

  if (activeSesion && activeSesion.scheduled_at === b.slot_iso) {
    // Re-submit del mismo slot → idempotente
    classId = activeSesion.id as string;
    shortCode = activeSesion.short_code as string | null;
  } else if (activeSesion) {
    // Reagendamiento: mover la sesión existente
    const { error: updErr } = await sb.from("classes").update({
      scheduled_at: b.slot_iso,
      sesion_closer_id: preferredCloserId,
      notified_at: null,
      notify_after_at: new Date().toISOString(),
    }).eq("id", activeSesion.id);
    if (updErr) {
      return NextResponse.json({ error: "slot_taken" }, { status: 409 });
    }
    classId = activeSesion.id as string;
    shortCode = activeSesion.short_code as string | null;
    rescheduled = true;
    await sb.from("leads").update({ sesion_plan_at: b.slot_iso }).eq("id", leadId);
    // Mover también la tarea pendiente del closer
    await sb.from("tareas_closer")
      .update({ fecha_programada: b.slot_iso, closer_id: preferredCloserId })
      .eq("lead_id", leadId)
      .eq("tipo", "sesion_plan")
      .is("fecha_completada", null);
  } else {
    // Insert nuevo — intenta el closer preferido; si su horario exacto
    // choca (unique index 105), cae al closer del slot.
    const baseRow = {
      type: "individual" as const,
      teacher_id: null,
      scheduled_at: b.slot_iso,
      duration_minutes: SESION_MINUTES,
      title: `Sesión de Plan — ${b.name.split(/\s+/)[0]}`,
      status: "scheduled" as const,
      is_trial: false,
      lead_id: leadId,
      notes_admin: `auto-booked via /sesion-plan · goal=${b.qualification.goal} level=${b.qualification.level}`,
      notify_after_at: new Date().toISOString(),
    };

    let inserted = await sb.from("classes")
      .insert({ ...baseRow, sesion_closer_id: preferredCloserId })
      .select("id, short_code").single();

    if (inserted.error && preferredCloserId !== b.closer_id &&
        (inserted.error.code === "23505" || /no_double_booking_closer/.test(inserted.error.message))) {
      // El closer del lead está ocupado a esa hora → closer del slot
      inserted = await sb.from("classes")
        .insert({ ...baseRow, sesion_closer_id: b.closer_id })
        .select("id, short_code").single();
    }

    if (inserted.error || !inserted.data) {
      const msg = inserted.error?.message ?? "";
      if (inserted.error?.code === "23505" || /no_double_booking/.test(msg)) {
        return NextResponse.json({ error: "slot_taken" }, { status: 409 });
      }
      return NextResponse.json({ error: "class_create_failed" }, { status: 500 });
    }
    classId = inserted.data.id as string;
    shortCode = inserted.data.short_code as string | null;
  }

  // Closer final (por si hubo fallback)
  const { data: clsRow } = await sb.from("classes").select("sesion_closer_id, short_code").eq("id", classId).single();
  const finalCloserId = (clsRow?.sesion_closer_id as string) ?? b.closer_id;
  shortCode = shortCode ?? (clsRow?.short_code as string | null);

  // ── Lead sin closer → el de la sesión pasa a ser su closer (sin cadencia) ──
  if (!leadCloserId) {
    await sb.from("leads").update({
      closer_id: finalCloserId,
      estado_cierre: "activo",
      fecha_asignacion_closer: new Date().toISOString(),
    }).eq("id", leadId).is("closer_id", null);
  }

  // ── Tarea en la cola HOY del closer (ancla del semáforo) ──
  // Solo al crear sesión nueva; en reagendamiento la tarea ya se movió,
  // y en re-submit idempotente no hay nada que crear.
  if (!activeSesion) {
    await sb.from("tareas_closer").insert({
      closer_id: finalCloserId,
      lead_id: leadId,
      paso: 1,
      tipo: "sesion_plan",
      canal: "llamada",
      plantilla: "Sesión de Plan (15 min) — videollamada con el lead",
      fecha_programada: b.slot_iso,
      prioridad: "alta",
      origen: "manual",
    });
  }

  // ── (c) R3: la sesión es una respuesta → pausar TODOS los outbounds.
  // Gelfis 2026-08-14 (Opción B "garantía anti-bombardeo"): antes solo
  // pausaba lead_chains vía pauseChain. Ahora pauseAllOutbound también
  // setea leads.ai_paused_until, que respetan los crons trial-reminders-*,
  // teacher-reschedule, sesion-notifications, diagnostico-followups y
  // el motor lead_chains (advanceChain). Un lead con sesión agendada
  // NO recibe mensajes de otras cadenas hasta 24h post-sesión.
  const pauseUntil = new Date(new Date(b.slot_iso).getTime() + 24 * 3600_000);
  await pauseAllOutbound(leadId, pauseUntil).catch(() => {});

  // ── Magic link ──
  const token = buildTrialToken(leadId, classId);
  const joinUrl = buildLeadJoinUrl({ classId, leadId, shortCode, baseUrl: PLATFORM_URL });
  const confirmacionUrl = `${PLATFORM_URL}/confirmacion?c=${classId}&t=${encodeURIComponent(token)}`;

  const startDate = new Date(b.slot_iso).toLocaleString("es-ES", {
    timeZone: "Europe/Berlin", weekday: "long", day: "numeric", month: "long",
    hour: "2-digit", minute: "2-digit",
  });

  after(async () => {
    try {
      await sb.from("lead_timeline").insert({
        lead_id: leadId,
        type: "status_change",
        author: "system",
        content: rescheduled
          ? `📋 Sesión de Plan reagendada a ${startDate} (Berlín) con el closer.`
          : `📋 Sesión de Plan agendada para ${startDate} (Berlín) — 15 min por videollamada con el closer. Cadena pausada (R3).`,
        metadata: {
          kind: "sesion_plan_booked",
          class_id: classId,
          closer_id: finalCloserId,
          qualification: b.qualification,
          rescheduled,
        },
      });

      await createAdminNotification({
        type: "sesion_plan_booked",
        severity: "info",
        title: rescheduled ? "Sesión de Plan reagendada" : "Nueva Sesión de Plan",
        body: `${b.name} agendó Sesión de Plan para ${startDate} (Berlín).`,
        lead_id: leadId,
        action_url: `/admin/leads/${leadId}`,
        dedupeHours: false,
      });

      // Notificación WA al closer con nombre, meta y hora (Gelfis 2026-08-14).
      // Espejo de la notificación al profe en trials. Solo en booking nuevo;
      // en reschedule ya recibió la primera notif y el T-15m del cron cubre.
      if (!rescheduled) {
        await notifyCloserOnBooking(sb, classId).catch(err => {
          console.error("[book-sesion-plan] notifyCloserOnBooking error:", err);
        });
      }
    } catch (err) {
      console.error("[book-sesion-plan] after() error:", err);
    }
  });

  return NextResponse.json({
    ok: true,
    classId,
    leadId,
    token,
    closerName: match.closerName,
    startDate,
    rescheduled,
    isNewLead,
    confirmacionUrl,
    joinUrl,
  });
}
