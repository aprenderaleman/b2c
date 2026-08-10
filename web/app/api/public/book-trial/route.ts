import { NextResponse, after } from "next/server";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase";
import { listTrialSlots } from "@/lib/trial-slots";
import { buildTrialToken, buildLeadJoinUrl } from "@/lib/trial-token";
// Depósito Stripe (Gelfis 2026-06-30): email + WhatsApp de confirmación
// se envían desde el cron send-trial-notifications (5min tras el book).
// buildEmailActionUrl, sendTrialConfirmationEmail y sendWhatsappText
// no se usan aquí — están importados en el cron.
import { checkRateLimit, ipFromHeaders } from "@/lib/rate-limit";
import { createTrialEvent } from "@/lib/google-calendar";
import { sanitizeE164 } from "@/lib/phone";
// buildTrialIcs se usa desde el cron send-trial-notifications ahora
// (para adjuntar el .ics al email de confirmación 5min después).
import { notifyTeacherOfTrial } from "@/lib/teacher-trial-notification";
import { notifyNewLeadUrgent, leadAlertsEnabled } from "@/lib/lead-alerts";
import { createTeacherTrialEvent } from "@/lib/google-calendar-oauth";
import { sendRaw } from "@/lib/email/send";

/** Random URL-safe 8-char code, used as the magic-link short ID. */
function generateShortCode(): string {
  // base36 → 26 letters + 10 digits, lowercase, friendly to type/share.
  return randomBytes(6).toString("base64url").replace(/[_-]/g, "").slice(0, 8).toLowerCase();
}

/**
 * POST /api/public/book-trial
 *
 * Public endpoint hit by the funnel's last step. Body:
 *   {
 *     name, email, whatsapp_e164 (optional), whatsapp_raw (optional),
 *     german_level, goal, language,
 *     slot_iso, teacher_id
 *   }
 *
 * Behaviour:
 *   1. If a USER already exists with this email → "already registered"
 *      (per Gelfis: existing students log in, they don't re-book trials).
 *   2. Re-validate the slot is still free. If two leads race for it,
 *      the second sees "ese horario acaba de reservarse, elige otro".
 *   3. Upsert the LEAD (no user/student row created — that happens at
 *      payment time). Mark status='trial_scheduled' + trial_scheduled_at.
 *   4. Create the trial CLASS (is_trial=true, lead_id, livekit_room_id).
 *      No class_participants row — the lead joins via magic link.
 *   5. Send confirmation: email (Resend/SMTP) + WhatsApp (Evolution).
 *      Both fire-and-forget so a 1-channel hiccup doesn't fail the
 *      whole booking.
 *   6. Return { ok, classId, magicLinkUrl } — the funnel uses these
 *      to render the confirmation screen.
 */

export const runtime  = "nodejs";
export const dynamic  = "force-dynamic";

const PLATFORM_URL = (process.env.PLATFORM_URL ?? "https://b2c.aprender-aleman.de").replace(/\/$/, "");
const TRIAL_DURATION_MIN = 30;

// WhatsApp es OPCIONAL desde 2026-06-XX (Gelfis: todo lead debe poder
// agendar incluso sin WA). Si el lead no lo da, la confirmación va
// solo por email y NO se envían recordatorios por WhatsApp. El lead
// puede añadirlo después respondiendo al email de confirmación.
const Body = z.object({
  name:           z.string().trim().min(2).max(100),
  email:          z.string().trim().toLowerCase().email(),
  whatsapp_e164:  z.string().trim().min(8).nullable().optional(),
  whatsapp_raw:   z.string().trim().min(4).nullable().optional(),
  // Sincronizado con los 6 niveles del funnel post-2026-05-26
  // (A0/A1/A2/B1/B2/C1). Conservamos los antiguos por compat con
  // clientes en caché o leads creados manualmente desde admin con
  // el enum viejo.
  german_level:   z.enum([
    "A0", "A1", "A2", "B1", "B2", "C1",
    "A1.1", "A1.2", "A2.1", "A2.2", "A1-A2", "B2+",
  ]).nullable().optional(),
  goal:           z.string().trim().max(60).nullable().optional(),
  // Gelfis 2026-07-20: TODO en español. Aceptamos el campo para no
  // romper el frontend viejo pero lo pisamos por defecto a "es" abajo.
  language:       z.enum(["es", "de"]).default("es").transform(() => "es" as const),
  slot_iso:       z.string().datetime(),
  teacher_id:     z.string().uuid(),
  // Atribución a landing (Gelfis 2026-06-15). Lo manda /agendar/cuando
  // — el flujo del quiz ya lo persiste por register. Cuando viene:
  //   - Si body trae motivo_inicial → lo usamos tal cual.
  //   - Si no → marcamos 'direct' (atajo puro desde landing dedicada).
  // En ambos casos se inserta una fila sintética en lead_motivo_inicial
  // con session_id='direct_{leadId}' para que /admin/ads cuente la
  // entrada en el funnel.
  landing_intent: z.string().trim().max(40).nullable().optional(),
  motivo_inicial: z.enum([
    "particulares", "intensivo", "certificado", "profesional", "otro", "direct",
  ]).nullable().optional(),
  // Atribución publicitaria — opcional, lo manda /agendar/cuando vía
  // sessionStorage (helper lib/ads-attribution). Sin esto Google Ads
  // pierde la conversión offline en el cron ads-conversions-export
  // (filtra WHERE gclid IS NOT NULL).
  gclid:         z.string().trim().max(200).nullable().optional(),
  gbraid:        z.string().trim().max(200).nullable().optional(),
  wbraid:        z.string().trim().max(200).nullable().optional(),
  utm_source:    z.string().trim().max(120).nullable().optional(),
  utm_medium:    z.string().trim().max(120).nullable().optional(),
  utm_campaign:  z.string().trim().max(200).nullable().optional(),
  utm_term:      z.string().trim().max(200).nullable().optional(),
  utm_content:   z.string().trim().max(200).nullable().optional(),
});

export async function POST(req: Request) {
  // Rate limit BEFORE parsing the body — keeps Postgres + Resend safe
  // from a flood of garbage POSTs and stops a single IP from booking
  // every available slot to grief the academy. Window: 5 / hour / IP.
  // The rare legit case of a family booking two trials in the same
  // hour from one IP still works (cap is 5).
  const ip = ipFromHeaders(req);
  // Cap configurable vía env para poder subirlo temporalmente durante
  // diagnóstico (Meta CAPI, etc.) sin cambios de código. Default 5/h/IP
  // protege Postgres+Resend en operación normal.
  const rlMax = Math.max(1, Number(process.env.BOOK_TRIAL_RATE_LIMIT_MAX ?? 5));
  const rl = await checkRateLimit({
    scope:    "book_trial",
    key:      ip,
    max:      rlMax,
    windowMs: 60 * 60_000,
  });
  if (!rl.ok) {
    return NextResponse.json(
      {
        error:   "rate_limited",
        message: `Demasiadas reservas desde tu conexión. Espera ${Math.ceil(rl.retryAfterSeconds / 60)} min e inténtalo de nuevo.`,
      },
      {
        status:  429,
        headers: { "Retry-After": String(rl.retryAfterSeconds) },
      },
    );
  }

  let raw: unknown;
  try { raw = await req.json(); }
  catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }

  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    const flat = parsed.error.flatten();
    console.error("[book-trial] validation_failed", {
      raw,
      fieldErrors: flat.fieldErrors,
      formErrors:  flat.formErrors,
    });
    // Build a human-readable summary so the funnel can surface it.
    const fieldMessages = Object.entries(flat.fieldErrors)
      .map(([k, msgs]) => `${k}: ${(msgs ?? []).join(", ")}`)
      .join(" · ");
    return NextResponse.json(
      {
        error:   "validation_failed",
        message: fieldMessages || "Datos inválidos",
        details: flat,
      },
      { status: 400 },
    );
  }
  const b = parsed.data;
  // Defense-in-depth: sanea el WhatsApp E.164 contra el bug de doble
  // country code (caso Juan José 2026-05-07: "+3434615541087"). El
  // frontend ya lo hace pero este endpoint también lo llaman otras
  // entradas (mobile dev, WP plugin, etc.).
  // sanitizeE164 espera string; con null/undefined lo dejamos tal cual.
  if (b.whatsapp_e164) {
    b.whatsapp_e164 = sanitizeE164(b.whatsapp_e164);
  }
  const sb = supabaseAdmin();

  // ── 1. Already a registered student? Reject.
  const { data: existingUser } = await sb
    .from("users")
    .select("id, email, role")
    .eq("email", b.email)
    .maybeSingle();
  if (existingUser) {
    return NextResponse.json({
      error:   "already_registered",
      message: "Ya estás registrado. Inicia sesión y agenda desde tu panel.",
      login_url: `${PLATFORM_URL}/login`,
    }, { status: 409 });
  }

  // ── 2. Re-validate the slot is still in the available list.
  const slots = await listTrialSlots();
  const match = slots.find(s =>
    s.startIso === b.slot_iso && s.teacherId === b.teacher_id);
  if (!match) {
    return NextResponse.json({
      error:   "slot_taken",
      message: "Ese horario acaba de reservarse o dejó de estar disponible. Elige otro.",
    }, { status: 409 });
  }

  // ── 3. Upsert the lead.
  // Match by email FIRST. If no email match and the lead provided their
  // WhatsApp number, also try to match by `whatsapp_normalized` — this
  // catches the legacy WhatsApp-first lead who later self-books via the
  // funnel; without this we'd create a duplicate row.
  const orFilters: string[] = [`email.eq.${b.email}`];
  if (b.whatsapp_e164) {
    orFilters.push(`whatsapp_normalized.eq.${b.whatsapp_e164}`);
  }
  const { data: existingLead } = await sb
    .from("leads")
    .select("id, email, whatsapp_normalized, motivo_inicial, landing_intent, gclid, gbraid, wbraid, utm_source, utm_medium, utm_campaign, utm_term, utm_content")
    .or(orFilters.join(","))
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // `goal` is NOT NULL on `leads` — fall back if the funnel ever
  // forgets to send one. Same for `urgency`, where booking a trial
  // implies they're moving fast → "asap" is the right default. The
  // column doesn't exist on our funnel UI; admin can refine later.
  const goal    = b.goal ?? "travel";
  const urgency = "asap";

  let leadId: string;
  let isNewLead = false;
  if (existingLead) {
    const existing = existingLead as {
      id: string;
      email: string | null;
      whatsapp_normalized: string | null;
      motivo_inicial: string | null;
      landing_intent: string | null;
      gclid:        string | null;
      gbraid:       string | null;
      wbraid:       string | null;
      utm_source:   string | null;
      utm_medium:   string | null;
      utm_campaign: string | null;
      utm_term:     string | null;
      utm_content:  string | null;
    };
    leadId = existing.id;
    // Preserve any contact info we already had — only fill blanks.
    // (e.g. legacy WhatsApp-first lead now booking with their email →
    // we want to keep both channels, not overwrite the WhatsApp.)
    // trial_zoom_link is filled in below right after we know the
    // class id + short code so old agent_5 reminder code (running
    // on a not-yet-redeployed VPS) doesn't ship an empty "Enlace:".
    // Atribución (Gelfis 2026-06-15): preferimos lo que ya tenía el lead
    // (no pisar motivo del quiz si llegó por register). Si nada, usamos
    // lo del body — motivo_inicial real si lo trae (socialmedia), o
    // 'direct' si solo viene landing_intent (atajo de landing dedicada).
    const updateLanding   = b.landing_intent ?? existing.landing_intent ?? null;
    const updateMotivoIni = existing.motivo_inicial
      ?? b.motivo_inicial
      ?? (b.landing_intent ? "direct" : null);
    // Atribución publicitaria — preferimos lo que ya tenía (primera
    // visita es la que cuenta para Smart Bidding); solo llenamos blanks.
    const adAttribution = {
      gclid:        existing.gclid        ?? b.gclid        ?? null,
      gbraid:       existing.gbraid       ?? b.gbraid       ?? null,
      wbraid:       existing.wbraid       ?? b.wbraid       ?? null,
      utm_source:   existing.utm_source   ?? b.utm_source   ?? null,
      utm_medium:   existing.utm_medium   ?? b.utm_medium   ?? null,
      utm_campaign: existing.utm_campaign ?? b.utm_campaign ?? null,
      utm_term:     existing.utm_term     ?? b.utm_term     ?? null,
      utm_content:  existing.utm_content  ?? b.utm_content  ?? null,
    };
    await sb.from("leads").update({
      name:                 b.name,
      email:                existing.email ?? b.email,
      whatsapp_normalized:  existing.whatsapp_normalized ?? b.whatsapp_e164  ?? null,
      whatsapp_raw:         existing.whatsapp_normalized ? undefined : (b.whatsapp_raw ?? null),
      german_level:         b.german_level   ?? null,
      goal,
      urgency,
      language:             b.language,
      status:               "trial_scheduled",
      trial_scheduled_at:   b.slot_iso,
      // Caso Andreina 2026-08-06: al reagendar, la phase
      // AWAITING_TEACHER_REBOOK quedaba puesta y TODOS los crons de
      // recordatorio saltaban al lead (llegó a su clase sin ningún
      // recordatorio ni link a mano). Al agendar SIEMPRE se limpia.
      reschedule_state:     null,
      landing_intent:       updateLanding,
      motivo_inicial:       updateMotivoIni,
      ...adAttribution,
      gdpr_accepted:        true,
      gdpr_accepted_at:     new Date().toISOString(),
      source:               "funnel_trial_self_book",
    }).eq("id", leadId);
  } else {
    const insertLanding   = b.landing_intent ?? null;
    const insertMotivoIni = b.motivo_inicial
      ?? (b.landing_intent ? "direct" : null);
    const { data: newLead, error: insErr } = await sb.from("leads").insert({
      name:                 b.name,
      email:                b.email,
      whatsapp_normalized:  b.whatsapp_e164  ?? null,
      whatsapp_raw:         b.whatsapp_raw   ?? null,
      german_level:         b.german_level   ?? null,
      goal,
      urgency,
      language:             b.language,
      status:               "trial_scheduled",
      trial_scheduled_at:   b.slot_iso,
      landing_intent:       insertLanding,
      motivo_inicial:       insertMotivoIni,
      gclid:                b.gclid        ?? null,
      gbraid:               b.gbraid       ?? null,
      wbraid:               b.wbraid       ?? null,
      utm_source:           b.utm_source   ?? null,
      utm_medium:           b.utm_medium   ?? null,
      utm_campaign:         b.utm_campaign ?? null,
      utm_term:             b.utm_term     ?? null,
      utm_content:          b.utm_content  ?? null,
      gdpr_accepted:        true,
      gdpr_accepted_at:     new Date().toISOString(),
      source:               "funnel_trial_self_book",
    }).select("id").single();
    if (insErr || !newLead) {
      return NextResponse.json({
        error: "lead_create_failed",
        message: insErr?.message ?? "unknown",
      }, { status: 500 });
    }
    isNewLead = true;
    // Atajo desde landing: registramos una entrada sintética en
    // lead_motivo_inicial para que el dashboard /admin/ads cuente
    // este lead en "Entradas paso 1" y la cadena del funnel no quede
    // descuadrada. session_id = 'direct_{leadId}' garantiza unicidad
    // (índice único) y deja claro el origen al auditar la tabla.
    leadId = (newLead as { id: string }).id;
    // Cuenta el lead en "Entradas paso 1" del dashboard. Solo cuando es
    // un atajo puro (motivo='direct') — si viene del quiz (socialmedia,
    // particulares, etc.) la fila ya existe en lead_motivo_inicial creada
    // por /api/public/motivo cuando el lead respondió step 1.
    if (b.landing_intent && insertMotivoIni === "direct") {
      await sb.from("lead_motivo_inicial").insert({
        lead_id:        leadId,
        session_id:     `direct_${leadId}`,
        motivo:         "direct",
        landing_intent: b.landing_intent,
      });
    }
  }

  // ── 3.5. Anti-double-booking + auto-reschedule.
  //
  // Si el lead ya tiene una clase activa, distinguimos 2 casos:
  //
  //   A) Slot pedido == slot existente → es un re-submit (lead pulsó
  //      "Confirmar" dos veces, refrescó /confirmacion, etc). Devolver
  //      la existente. Evita crear duplicados (caso Bayron 2026-04-29).
  //
  //   B) Slot pedido != slot existente → es un RE-AGENDADO via self-
  //      service. El lead reservó originalmente, no pudo ir, pidió a
  //      Stiv reagendar, recibió el link /agendar/cuando y eligió un
  //      slot nuevo. Antes (bug Ana 2026-06-19) devolvíamos la vieja
  //      silenciosamente, dejando leads.trial_scheduled_at (ya
  //      actualizado por el upsert arriba) descincronizado con
  //      classes.scheduled_at. Ahora: UPDATE la clase al nuevo slot
  //      + reset notes_admin para que los crons de recordatorios
  //      re-disparen en la fecha nueva.
  //
  // Google Calendar: el evento del profe SÍ se patchea aquí desde el
  // bug Pedro 2026-06-25 (antes quedaba desincronizado y el profe veía
  // el slot viejo en su agenda). Si el patch falla → rollback de la
  // actualización en BD para no dejar inconsistencia silenciosa.
  {
    const { data: existingTrials } = await sb
      .from("classes")
      .select("id, scheduled_at, short_code, google_calendar_event_id, duration_minutes, teacher_id")
      .eq("lead_id", leadId)
      .eq("is_trial", true)
      .in("status", ["scheduled", "live"])
      .gte("scheduled_at", new Date(Date.now() - 60 * 60_000).toISOString())
      .order("scheduled_at", { ascending: true });
    type ExistingTrial = {
      id: string; scheduled_at: string; short_code: string;
      google_calendar_event_id: string | null; duration_minutes: number | null;
      teacher_id: string;
    };
    const active = (existingTrials ?? []) as ExistingTrial[];
    if (active.length > 0) {
      const ex = active[0];
      const existingSlotIso = new Date(ex.scheduled_at).toISOString();
      const requestedSlotIso = new Date(b.slot_iso).toISOString();

      if (existingSlotIso === requestedSlotIso) {
        // Caso A: mismo slot → re-submit, devolver existente sin tocar.
        const token = buildTrialToken(leadId, ex.id);
        return NextResponse.json({
          ok: true,
          classId: ex.id,
          leadId,
          token,
          already: true,
          scheduled_at: ex.scheduled_at,
        });
      }

      // Caso B: slot distinto → auto-reschedule. UPDATE + reset notes
      // para que los crons de recordatorios re-disparen en la fecha
      // nueva. lead_timeline registra el cambio para auditoría.
      // Bug Sabine 2026-08-10: antes NO se actualizaba teacher_id →
      // el lead elegía un slot de otro profe pero la clase quedaba
      // asignada al profe original (fuera de su disponibilidad).
      const { error: rescheduleErr } = await sb
        .from("classes")
        .update({
          scheduled_at:    requestedSlotIso,
          teacher_id:      b.teacher_id,
          notes_admin:     null,
          // Fix Gelfis 2026-07-24: sin resetear notified_at el cron
          // send-trial-notifications no re-envía la confirmación con
          // la nueva hora (filtra notified_at IS NULL), y el lead se
          // presenta al link muerto de la hora vieja.
          notified_at:     null,
          notify_after_at: new Date().toISOString(),
        })
        .eq("id", ex.id);
      if (rescheduleErr) {
        return NextResponse.json({
          error:   "auto_reschedule_failed",
          message: rescheduleErr.message,
        }, { status: 500 });
      }

      // Patchear Google Calendar event del profe (si existe). Si falla
      // → rollback de la BD para no dejar inconsistencia. Caso Pedro
      // 2026-06-25: antes la BD se actualizaba pero Calendar quedaba en
      // el slot viejo → el profe se conectaba a la hora equivocada.
      if (ex.google_calendar_event_id) {
        const { patchTrialEvent } = await import("@/lib/google-calendar");
        let patched = false;
        try {
          patched = await patchTrialEvent(
            ex.google_calendar_event_id,
            requestedSlotIso,
            ex.duration_minutes ?? TRIAL_DURATION_MIN,
          );
        } catch (e) {
          console.error("[book-trial] gcal patch threw:", e);
        }
        if (!patched) {
          // Rollback — no dejar BD y Calendar desincronizados.
          // Restaurar teacher_id original junto con scheduled_at.
          await sb.from("classes")
            .update({ scheduled_at: ex.scheduled_at, teacher_id: ex.teacher_id })
            .eq("id", ex.id);
          return NextResponse.json({
            error:   "gcal_patch_failed",
            message: "No pudimos actualizar el calendario del profesor. Inténtalo de nuevo o avísanos por WhatsApp.",
          }, { status: 500 });
        }
      }

      const teacherChanged = ex.teacher_id !== b.teacher_id;
      await sb.from("lead_timeline").insert({
        lead_id: leadId,
        type:    "status_change",
        author:  "system",
        content: `Trial reagendado vía self-service: ${existingSlotIso} → ${requestedSlotIso}.${teacherChanged ? ` Profesor reasignado a ${match.teacherName}.` : ""} Google Calendar patched.`,
      });

      if (teacherChanged) {
        await notifyTeacherOfTrial({
          teacherId:   b.teacher_id,
          leadName:    b.name,
          startIso:    requestedSlotIso,
          germanLevel: b.german_level ?? null,
          goal:        b.goal ?? "travel",
          classId:     ex.id,
        }).catch(e => console.error("[book-trial] reschedule teacher notification failed:", e));

        await createTeacherTrialEvent(b.teacher_id, {
          leadName:        b.name,
          teacherName:     match.teacherName,
          startIso:        requestedSlotIso,
          durationMinutes: ex.duration_minutes ?? TRIAL_DURATION_MIN,
          leadEmail:       b.email,
          leadWhatsapp:    b.whatsapp_e164 ?? null,
          germanLevel:     b.german_level ?? null,
          goal:            b.goal ?? "travel",
          joinUrl:         buildLeadJoinUrl({ classId: ex.id, leadId, shortCode: ex.short_code, baseUrl: PLATFORM_URL }),
        }).catch(e => console.error("[book-trial] reschedule teacher gcal event failed:", e));
      }

      const token = buildTrialToken(leadId, ex.id);
      return NextResponse.json({
        ok: true,
        classId:    ex.id,
        leadId,
        token,
        rescheduled: true,
        scheduled_at: requestedSlotIso,
      });
    }
  }

  // ── 4. Create the trial class.
  const teacherFirst = (match.teacherName.split(/\s+/)[0]) || match.teacherName;
  // Título comercial — el del lead va en el .ics y el evento de GCal.
  // Política Gelfis 2026-04-30: NO mencionar al profesor en mensajes
  // públicos. Para uso interno (DB row, admin UI) dejamos un título
  // separado que sí incluye al profe.
  const classTitle         = `${b.name.split(/\s+/)[0]} + Sesión de Prueba de Alemán ☀️`;
  const classTitleInternal = `Clase de prueba — ${b.name.split(/\s+/)[0]} (${teacherFirst})`;
  // Pre-generate a short code now so we don't need a follow-up update.
  // Collision is astronomically unlikely (8 base36 chars ≈ 2.8 trillion
  // values, and the unique index would catch one if it ever happened).
  const shortCode = generateShortCode();
  // Notificaciones inmediatas 2026-07-10 (depósito Stripe eliminado):
  // notify_after_at=NOW() → cron send-trial-notifications las envía en
  // el próximo tick (≤1 min de latencia). Antes había delay 5min para
  // dar tiempo al pago del depósito, ya no aplica.
  const notifyAfterAt = new Date().toISOString();
  const { data: cls, error: classErr } = await sb.from("classes").insert({
    type:               "individual",
    teacher_id:         b.teacher_id,
    scheduled_at:       b.slot_iso,
    duration_minutes:   TRIAL_DURATION_MIN,
    title:              classTitleInternal,
    topic:              b.goal ?? null,
    status:             "scheduled",
    is_trial:           true,
    lead_id:            leadId,
    short_code:         shortCode,
    notes_admin:        `auto-booked via funnel · level=${b.german_level ?? "?"}`,
    notify_after_at:    notifyAfterAt,
  }).select("id").single();
  if (classErr || !cls) {
    const isDupe = classErr?.message?.includes("classes_no_double_booking_uidx")
      || classErr?.code === "23505";
    if (isDupe) {
      return NextResponse.json({
        error:   "slot_taken",
        message: "Ese horario acaba de reservarse o dejó de estar disponible. Elige otro.",
      }, { status: 409 });
    }
    return NextResponse.json({
      error: "class_create_failed",
      message: classErr?.message ?? "unknown",
    }, { status: 500 });
  }
  const classId = (cls as { id: string }).id;

  // ── 5. Magic-link URLs.
  // Long URL (still issued for the email + the /confirmacion deep-link
  // — backwards compatible with leads who already received it).
  const token = buildTrialToken(leadId, classId);
  const magicLinkUrl = `${PLATFORM_URL}/trial/${classId}?t=${encodeURIComponent(token)}`;
  // Short URL — used in WhatsApp + email so messages don't carry a
  // 250-char signed token that looks like phishing. Construido vía
  // buildLeadJoinUrl() (devuelve LeadJoinUrl branded) para que los
  // templates trial-confirmation / trial-rescheduled lo acepten —
  // garantía estructural de no mandar bare /aula/{id} al lead.
  const shortLinkUrl = buildLeadJoinUrl({
    classId:   classId,
    leadId:    leadId,
    shortCode: shortCode,
    baseUrl:   PLATFORM_URL,
  });

  // Stash the short URL on the lead row so any code path that reads
  // `leads.trial_zoom_link` (e.g. the legacy agent_5 reminder still
  // running on the VPS until it's redeployed) ships a real link
  // instead of an empty "Enlace:" line.
  await sb.from("leads")
    .update({ trial_zoom_link: shortLinkUrl })
    .eq("id", leadId);

  // b.language forzado a "es" en el schema (commit 0d56d81) — dejo el
  // literal directo en vez de la ternaria que ya nunca elige el 'de'.
  const startDate = new Date(b.slot_iso).toLocaleString("es-ES", {
    timeZone: "Europe/Berlin",
    weekday:  "long",
    day:      "numeric",
    month:    "long",
    hour:     "2-digit",
    minute:   "2-digit",
  }) + " (Berlín)";

  // Hora local para leads fuera de zona europea — caso Alison 2026-06-16:
  // agendo 12:00 Berlin sin darse cuenta que en Colombia son 05:00 AM.
  // El prefijo telefonico nos dice tz aproximada. Si es zona europea, no
  // anadimos nada (la hora Berlin ya es local). Para Americas, Asia, etc.,
  // mostramos "(05:00 en tu hora local)" para que vean el desfase.
  const localTimeInfo = computeLocalTimeInfo(b.whatsapp_e164, b.slot_iso, b.language);

  // Email + WhatsApp run AFTER the response is sent.
  //
  // We tried two earlier approaches that didn't work:
  //   * fire-and-forget (no await): Vercel terminates the worker
  //     when the response is flushed, killing in-flight SMTP/HTTP.
  //   * blocking await: response was reliable but took 5-10s
  //     because the user waited for both deliveries to complete.
  //
  // Next.js 15's `after()` is the proper primitive: the worker
  // stays alive until the callback finishes, but the response
  // goes out immediately. Result: lead lands on /confirmacion in
  // ~500ms while email + WhatsApp send in the background.
  const leadFirst = b.name.split(/\s+/)[0] || b.name;
  // Política Gelfis 2026-04-30: NO mencionar nombre del profesor en
  // mensajes salientes al lead (información interna, no relevante).
  // Copy 2026-06-16: alineado al email (commit db1aa28) — sin amenaza
  // de "tu slot se libera" porque no existia handler real para CONFIRMO
  // ni cron que liberara slots (la promesa era falsa). Tono calido,
  // abre conversacion sin fricción. Si el lead quiere cancelar/mover
  // ya tenemos handler propio (reschedule_flow.py) que detecta esas
  // palabras en cualquier mensaje libre.
  // Copy 2026-06-17 (Gelfis): vuelve la confirmacion explicita
  // CONFIRMO/CAMBIAR/CANCELAR + "slot se libera en 12h" como presion
  // psicologica. Los handlers Python (reschedule_flow + agent_4) ahora
  // sí responden a CONFIRMO con un ack breve, y a CAMBIAR/CANCELAR con
  // el self-serve /agendar/cuando. La liberacion de slot a las 12h NO
  // se implementa — la frase es solo presion (la mayoria de leads no
  // comprueba si cumplimos, y los pocos que sí lo viven como olvido).
  // waText y buildTrialIcs se construyen ahora en el cron
  // send-trial-notifications con la misma lógica — DRY diferido.
  // `leadFirst` sigue usándose abajo por el teacher notification.

  after(async () => {
    // Only mirror to the SA-managed admin calendar when the assigned
    // teacher IS Gelfis (superadmin). Other teachers get events only
    // in their personal OAuth-connected calendar.
    let isAdminTeacher = false;
    {
      const { data: tRow } = await sb
        .from("teachers")
        .select("users(role)")
        .eq("id", b.teacher_id)
        .maybeSingle();
      type TRow = { users: { role: string } | Array<{ role: string }> | null };
      const u = (tRow as TRow | null)?.users;
      const role = (Array.isArray(u) ? u[0]?.role : u?.role) ?? "";
      isAdminTeacher = role === "superadmin";
    }

    await sb.from("lead_timeline").insert({
      lead_id: leadId,
      type:    "agent_note",
      author:  "system",
      content: `📬 Notificaciones (email + WA) programadas para ${new Date(notifyAfterAt).toISOString()} (delay 5min tras book — flujo depósito Stripe).`,
      metadata: { kind: "trial_notify_scheduled", class_id: classId, notify_after_at: notifyAfterAt },
    });

    // ── SA Calendar mirror — solo para trials asignados a Gelfis ──
    if (isAdminTeacher) {
      const [gcalResult] = await Promise.allSettled([
        createTrialEvent({
          leadName:        b.name,
          teacherName:     match.teacherName,
          startIso:        b.slot_iso,
          durationMinutes: TRIAL_DURATION_MIN,
          leadEmail:       b.email,
          leadWhatsapp:    b.whatsapp_e164 ?? null,
          germanLevel:     b.german_level ?? null,
          goal:            goal,
          joinUrl:         shortLinkUrl,
        }),
      ]);

      if (gcalResult.status === "fulfilled" && gcalResult.value) {
        await sb.from("classes")
          .update({ google_calendar_event_id: gcalResult.value.eventId })
          .eq("id", classId);
        await sb.from("lead_timeline").insert({
          lead_id: leadId,
          type:    "agent_note",
          author:  "system",
          content: `📅 Evento creado en Google Calendar (${gcalResult.value.eventId.slice(0, 12)}…)`,
          metadata: { kind: "google_calendar_event", event_id: gcalResult.value.eventId, class_id: classId },
        });
      } else {
        const reason = gcalResult.status === "rejected"
          ? (gcalResult.reason instanceof Error ? gcalResult.reason.message : String(gcalResult.reason))
          : "createTrialEvent_returned_null";
        console.error("[book-trial] google calendar create failed:", reason);
        await sb.from("lead_timeline").insert({
          lead_id: leadId,
          type:    "send_failed",
          author:  "system",
          content: `📅 Falló crear evento en Google Calendar — la clase NO aparecerá en el calendario hasta que un admin la cree manualmente`,
          metadata: { kind: "google_calendar_failed", class_id: classId, reason },
        });
      }
    }

    // ── Notify the assigned teacher (in-app bell + email) ──
    await notifyTeacherOfTrial({
      teacherId:   b.teacher_id,
      leadName:    b.name,
      startIso:    b.slot_iso,
      germanLevel: b.german_level ?? null,
      goal:        goal,
      classId,
    }).catch(e => console.error("[book-trial] teacher notification failed:", e));

    // ── Alerta interna a Gelfis SOLO si es lead nuevo (Gelfis
    //    2026-07-06). Antes solo el paso 5 del diagnóstico disparaba
    //    la alerta; los leads que entran directo por book-trial
    //    quedaban invisibles. Los que reagendan (existentes) NO
    //    generan alerta — solo cambios de fecha.
    if (isNewLead && leadAlertsEnabled()) {
      await notifyNewLeadUrgent({
        id:                  leadId,
        name:                b.name,
        email:               b.email,
        whatsapp_normalized: b.whatsapp_e164 ?? null,
        language:            b.language,
        country:             null,
        motivo_inicial:      b.motivo_inicial ?? (b.landing_intent ? "direct" : null),
        german_level:        b.german_level ?? null,
        goal:                goal,
        urgency:             urgency,
        budget:              null,
        diagnostico_answers: null,
      }).catch(e => console.error("[book-trial] new-lead alert failed:", e));
    }

    // ── Mirror event to teacher's personal Google Calendar (if connected) ──
    await createTeacherTrialEvent(b.teacher_id, {
      leadName:        b.name,
      teacherName:     match.teacherName,
      startIso:        b.slot_iso,
      durationMinutes: TRIAL_DURATION_MIN,
      leadEmail:       b.email,
      leadWhatsapp:    b.whatsapp_e164 ?? null,
      germanLevel:     b.german_level ?? null,
      goal:            goal,
      joinUrl:         shortLinkUrl,
    }).catch(e => console.error("[book-trial] teacher gcal event failed:", e));

    // ── Email notification to admin for EVERY new trial ──
    const trialAlertEmail = (process.env.NEW_LEAD_ALERT_EMAIL ?? "").trim();
    if (trialAlertEmail) {
      const trialDate = new Date(b.slot_iso).toLocaleString("es-ES", {
        timeZone: "Europe/Berlin",
        weekday: "long", day: "numeric", month: "long",
        hour: "2-digit", minute: "2-digit",
      });
      await sendRaw(
        trialAlertEmail,
        `📅 Nueva Clase de Prueba — ${leadFirst} con ${teacherFirst}`,
        [
          `<div style="font-family:sans-serif;max-width:520px">`,
          `<h2 style="color:#1e293b">📅 Nueva Clase de Prueba Agendada</h2>`,
          `<table style="border-collapse:collapse;width:100%">`,
          `<tr><td style="padding:6px 12px;font-weight:bold;color:#64748b">Lead</td><td style="padding:6px 12px">${b.name}</td></tr>`,
          `<tr><td style="padding:6px 12px;font-weight:bold;color:#64748b">Email</td><td style="padding:6px 12px">${b.email}</td></tr>`,
          `<tr><td style="padding:6px 12px;font-weight:bold;color:#64748b">WhatsApp</td><td style="padding:6px 12px">${b.whatsapp_e164 ?? "—"}</td></tr>`,
          `<tr><td style="padding:6px 12px;font-weight:bold;color:#64748b">Profesor/a</td><td style="padding:6px 12px">${match.teacherName}</td></tr>`,
          `<tr><td style="padding:6px 12px;font-weight:bold;color:#64748b">Fecha</td><td style="padding:6px 12px">${trialDate} (Berlín)</td></tr>`,
          b.german_level ? `<tr><td style="padding:6px 12px;font-weight:bold;color:#64748b">Nivel</td><td style="padding:6px 12px">${b.german_level}</td></tr>` : "",
          b.goal ? `<tr><td style="padding:6px 12px;font-weight:bold;color:#64748b">Objetivo</td><td style="padding:6px 12px">${b.goal}</td></tr>` : "",
          `</table>`,
          `<p style="margin-top:16px"><a href="${PLATFORM_URL}/admin/leads/${leadId}" style="color:#2563eb">Ver perfil del lead →</a></p>`,
          `</div>`,
        ].join("\n"),
        [
          `Nueva Clase de Prueba Agendada`,
          ``,
          `Lead: ${b.name}`,
          `Email: ${b.email}`,
          `WhatsApp: ${b.whatsapp_e164 ?? "—"}`,
          `Profesor/a: ${match.teacherName}`,
          `Fecha: ${trialDate} (Berlín)`,
          b.german_level ? `Nivel: ${b.german_level}` : "",
          b.goal ? `Objetivo: ${b.goal}` : "",
          ``,
          `Ver perfil: ${PLATFORM_URL}/admin/leads/${leadId}`,
        ].filter(Boolean).join("\n"),
      ).catch(e => console.error("[book-trial] admin trial alert email failed:", e));
    }
  });

  return NextResponse.json({
    ok:        true,
    classId,
    // leadId expuesto para que el frontend pueda disparar firePixelLead
    // y firePixelSchedule con transaction_id estable (dedup). Sin esto
    // el atajo /agendar/cuando perdía la conversión a Smart Bidding.
    leadId,
    // Token returned separately so the funnel can redirect to a
    // standalone /confirmacion?c=...&t=... page instead of rendering
    // the success screen inline.
    token,
    teacherName: match.teacherName,
    startDate,
    magicLinkUrl,
  });
}

/**
 * Mapeo prefijo telefonico → zona horaria IANA. Solo cubre regiones donde
 * mostrar la "hora local del lead" ayuda — leads europeos comparten TZ
 * con Berlin (o muy cercano) y veríamos algo redundante. Para leads en
 * Americas/Asia/Oceania mostramos el desfase para evitar el caso Alison
 * (agendó 12:00 Berlín sin notar que en Colombia son 05:00 AM).
 *
 * Si el prefijo no esta mapeado, devolvemos null y el mensaje sale sin
 * info de hora local (zona europea o desconocida).
 */
function computeLocalTimeInfo(
  whatsappE164: string | null | undefined,
  slotIso: string,
  language: "es" | "de",
): string | null {
  if (!whatsappE164) return null;
  const digits = whatsappE164.replace(/\D/g, "");
  if (!digits) return null;

  // Prefijos -> {tz, label}. Coverage: Americas + algunas zonas conflictivas.
  // Para EU/Africa cercana usamos null (hora Berlin ya es local o muy similar).
  const PREFIX_TO_TZ: Array<{ prefix: string; tz: string; label_es: string; label_de: string }> = [
    { prefix: "57",  tz: "America/Bogota",       label_es: "Colombia",            label_de: "Kolumbien" },
    { prefix: "58",  tz: "America/Caracas",      label_es: "Venezuela",           label_de: "Venezuela" },
    { prefix: "52",  tz: "America/Mexico_City",  label_es: "México",              label_de: "Mexiko" },
    { prefix: "54",  tz: "America/Argentina/Buenos_Aires", label_es: "Argentina", label_de: "Argentinien" },
    { prefix: "56",  tz: "America/Santiago",     label_es: "Chile",               label_de: "Chile" },
    { prefix: "51",  tz: "America/Lima",         label_es: "Perú",                label_de: "Peru" },
    { prefix: "593", tz: "America/Guayaquil",    label_es: "Ecuador",             label_de: "Ecuador" },
    { prefix: "591", tz: "America/La_Paz",       label_es: "Bolivia",             label_de: "Bolivien" },
    { prefix: "595", tz: "America/Asuncion",     label_es: "Paraguay",            label_de: "Paraguay" },
    { prefix: "598", tz: "America/Montevideo",   label_es: "Uruguay",             label_de: "Uruguay" },
    { prefix: "506", tz: "America/Costa_Rica",   label_es: "Costa Rica",          label_de: "Costa Rica" },
    { prefix: "507", tz: "America/Panama",       label_es: "Panamá",              label_de: "Panama" },
    { prefix: "504", tz: "America/Tegucigalpa",  label_es: "Honduras",            label_de: "Honduras" },
    { prefix: "503", tz: "America/El_Salvador",  label_es: "El Salvador",         label_de: "El Salvador" },
    { prefix: "502", tz: "America/Guatemala",    label_es: "Guatemala",           label_de: "Guatemala" },
    { prefix: "505", tz: "America/Managua",      label_es: "Nicaragua",           label_de: "Nicaragua" },
    { prefix: "53",  tz: "America/Havana",       label_es: "Cuba",                label_de: "Kuba" },
    { prefix: "1",   tz: "America/New_York",     label_es: "tu zona",             label_de: "deiner Zone" }, // genérico US/CA
  ];

  // Match por prefijo más largo primero.
  const matched = PREFIX_TO_TZ.sort((a, b) => b.prefix.length - a.prefix.length)
    .find(p => digits.startsWith(p.prefix));
  if (!matched) return null;

  try {
    const localTime = new Date(slotIso).toLocaleString(language === "de" ? "de-DE" : "es-ES", {
      timeZone: matched.tz,
      hour: "2-digit",
      minute: "2-digit",
    });
    const localLabel = language === "de" ? matched.label_de : matched.label_es;
    return language === "de"
      ? `(${localTime} in ${localLabel})`
      : `(${localTime} en ${localLabel})`;
  } catch {
    return null;
  }
}
