import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { sendTrialConfirmationEmail } from "@/lib/email/send";
import { sendWhatsappText } from "@/lib/whatsapp";
import { buildEmailActionUrl } from "@/lib/email-action-token";
import { buildLeadJoinUrl } from "@/lib/trial-token";
import { buildTrialIcs } from "@/lib/ics";
import { sendSesionConfirmations } from "@/lib/sesion-notifications";

/**
 * GET/POST /api/cron/send-trial-notifications
 *
 * Cron cada 1 min. Envía el email + WhatsApp de confirmación de clase
 * de prueba 5 min después de que el lead complete el book (delay para
 * dar tiempo a que pague el depósito de 10€ en Stripe).
 *
 * Selecciona `classes` donde:
 *   - is_trial = true
 *   - status   = 'scheduled'
 *   - notify_after_at <= NOW()
 *   - notified_at IS NULL
 *
 * Variante del mensaje según deposit_paid_at:
 *   - Si pagado: variante "plaza asegurada" — sin CTA al depósito.
 *   - Si NO pagado: variante estándar + línea "asegura tu plaza como
 *     prioritaria" con el link Stripe (STRIPE_DEPOSIT_URL).
 *
 * Auth: Bearer CRON_SECRET o X-Cron-Secret.
 */

export const runtime  = "nodejs";
export const dynamic  = "force-dynamic";

const PLATFORM_URL = (process.env.PLATFORM_URL ?? "https://b2c.aprender-aleman.de").replace(/\/$/, "");

// Link del Payment Link real de Stripe (10€ depósito). Se pega tal cual
// en los mensajes al lead cuando aún no ha pagado. Gelfis 2026-06-30.
const STRIPE_DEPOSIT_URL = process.env.NEXT_PUBLIC_STRIPE_DEPOSIT_URL
  ?? "https://buy.stripe.com/bJe6oAcXzd9W2xFedx0co0n?locale=es";

function authorisedCronRequest(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const bearer = req.headers.get("authorization");
  if (bearer && bearer.toLowerCase().startsWith("bearer ") && bearer.slice(7).trim() === expected) return true;
  return req.headers.get("x-cron-secret") === expected;
}

export async function GET(req: Request)  { return run(req); }
export async function POST(req: Request) { return run(req); }

async function run(req: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "cron_not_configured" }, { status: 503 });
  }
  if (!authorisedCronRequest(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const sb = supabaseAdmin();
  const now = new Date().toISOString();

  // Pending classes. LIMIT 20 por tick para no saturar Resend + Evolution
  // (60 emails/min y 10 WA/min soportables). Con cron cada 1min y ~1
  // book/min esperado en peak, más que suficiente.
  const { data: pending, error: pendErr } = await sb
    .from("classes")
    .select(`
      ${CLASS_SELECT}
    `)
    .eq("is_trial", true)
    .eq("status", "scheduled")
    .is("notified_at", null)
    .not("notify_after_at", "is", null)
    .lte("notify_after_at", now)
    .limit(20);

  if (pendErr) {
    return NextResponse.json({ error: "query_failed", reason: pendErr.message }, { status: 500 });
  }
  if (!pending || pending.length === 0) {
    const wa_retried = await retryPendingWhatsappConfirmations(sb).catch(() => 0);
    // Sesiones de Plan (closers) comparten este cron (2026-08-13)
    const sesiones = await sendSesionConfirmations(sb).catch(() => 0);
    return NextResponse.json({ ok: true, processed: 0, wa_retried, sesiones });
  }

  const results: Array<{ classId: string; email: boolean; wa: boolean | null; paid: boolean }> = [];

  for (const rawCls of (pending as ClassRow[])) {
    const c = rawCls;
    const lead = flat(c.lead);
    if (!lead) continue;

    // Lock atómico: reservamos la clase marcando notified_at ANTES
    // de mandar. Si el UPDATE no retorna fila, otro tick del cron la
    // agarró primero. Fix Gelfis 2026-07-24: con 20 rows y gap 15s
    // entre WA, el tick tarda ~5 min y el siguiente tick reenviaba
    // confirmación + email al mismo lead. Ahora es idempotente.
    const { data: reserved } = await sb.from("classes")
      .update({ notified_at: new Date().toISOString() })
      .eq("id", c.id)
      .is("notified_at", null)
      .select("id")
      .maybeSingle();
    if (!reserved) continue;

    const teacherWrap = flat(c.teacher);
    const tu = teacherWrap ? flat(teacherWrap.users) : null;
    const teacherName = tu?.full_name ?? tu?.email ?? "tu profesor/a";

    const language: "es" | "de" = lead.language === "de" ? "de" : "es";
    const leadFirst = (lead.name ?? "").trim().split(/\s+/)[0] || (lead.name ?? "");
    const durationMin = c.duration_minutes ?? 40;
    // "paid" ahora combina el legacy classes.deposit_paid_at (flow
    // pre-2026-07) con leads.reserva_prioritaria (nuevo flow depósito
    // introducido con Meta Ads Paid 2026-07-28).
    const paid = !!c.deposit_paid_at || lead.reserva_prioritaria === true;
    const isMetaAdsPaid = lead.landing_intent === "meta-ads-paid";
    const goalLabel = qualificationGoalLabel((lead.qualification_answers ?? {}).goal);

    const startDate = new Date(c.scheduled_at).toLocaleString(language === "de" ? "de-DE" : "es-ES", {
      timeZone: "Europe/Berlin", weekday: "long", day: "numeric", month: "long",
      hour: "2-digit", minute: "2-digit",
    }) + (language === "de" ? " (Berlin)" : " (Berlín)");

    const joinUrl = buildLeadJoinUrl({
      classId: c.id, leadId: lead.id, shortCode: c.short_code, baseUrl: PLATFORM_URL,
    });

    const classTitle = `${leadFirst || "Estudiante"} + Sesión de Prueba de Alemán ☀️`;

    // Build .ics (calendar attachment)
    const icsContent = buildTrialIcs({
      uid:           c.id,
      startIso:      c.scheduled_at,
      durationMin,
      summary:       classTitle,
      description:
        `¿Quieres probar nuestro método antes de comprometerte?\n\n` +
        `Reserva una sesión individual de 40 minutos con un profesor bilingüe experto. Analizaremos tu nivel, definiremos tus objetivos y vivirás la experiencia de nuestra metodología.\n\n` +
        `Aula virtual: ${joinUrl}\n\n` +
        `Importante: al abrir el enlace tu navegador te pedirá permiso para micrófono y cámara — pulsa "Permitir".`,
      organizerName:  "Aprender-Aleman.de",
      organizerEmail: "aprenderaleman2026@gmail.com",
      attendeeName:   lead.name ?? "",
      attendeeEmail:  lead.email ?? "",
      location:       joinUrl,
    });

    // Email
    let emailOk = false;
    if (lead.email) {
      const r = await sendTrialConfirmationEmail(lead.email, {
        leadName:    leadFirst || "amigo",
        classTitle,
        startDate,
        durationMin,
        teacherName,
        joinUrl,
        confirmUrl:    buildEmailActionUrl({ leadId: lead.id, classId: c.id, action: "confirm" }),
        rescheduleUrl: buildEmailActionUrl({ leadId: lead.id, classId: c.id, action: "reschedule" }),
        language,
        depositPaid:   paid,
        depositUrl:    paid ? null : STRIPE_DEPOSIT_URL,
      }, { content: icsContent, filename: "clase-de-prueba-aleman.ics" });
      emailOk = r.ok;
      await sb.from("lead_timeline").insert({
        lead_id: lead.id,
        type:    r.ok ? "system_message_sent" : "send_failed",
        author:  "system",
        content: r.ok
          ? `[Email: Confirmación clase de prueba ${startDate}${paid ? " · plaza asegurada" : ""}]\n\nEnviado a ${lead.email}`
          : `📧 Falló el email de confirmación: ${r.error}`,
        metadata: { channel: "email", kind: paid ? "trial_confirmation_paid" : "trial_confirmation", class_id: c.id, sent_to: lead.email },
      });
    }

    // Gelfis 2026-11-15 — reactivamos WhatsApp para los 4 mensajes
    // auto esenciales (post-bans v5+v6, por canal setter v6 calentado).
    // Copy nuevo: breve, 40 min, sin enlace (el aula va por email),
    // pide confirmación. Fuera: la promo pre-venta encubierta anterior.
    let waOk: boolean | null = null;
    if (lead.whatsapp_normalized) {
      void isMetaAdsPaid; void goalLabel; // reservados para variantes futuras
      const waText = buildConfirmationWa({ leadFirst, startDate });
      const r = await sendWhatsappText(lead.whatsapp_normalized, waText, {
        kind: "trial_confirmation",
        channel: "setter",
      });
      waOk = r.ok;
      await sb.from("lead_timeline").insert({
        lead_id: lead.id,
        type:    r.ok ? "system_message_sent" : "send_failed",
        author:  "system",
        content: r.ok
          ? `💬 WA confirmación clase de prueba enviado a ${lead.whatsapp_normalized}`
          : `💬 Falló WA confirmación: ${r.reason}`,
        metadata: { channel: "whatsapp", kind: "trial_confirmation", class_id: c.id, reason: r.ok ? undefined : r.reason },
      });
      // Gelfis 2026-11-25: si WA falla por cap/night_gate/hourly, stash
      // en wa_manual_pending para que aparezca en el panel y Gelfis/Sheila
      // lo envíen manual. Bug Esteban/Dina (los 13 leads afectados no
      // recibieron ni confirmación WA ni recovery manual porque este cron
      // no tenía la lógica que ya tenían los handlers del profe).
      if (!r.ok && /^(setter_daily_cap|night_gate|hourly_cap|daily_cap)/.test(r.reason ?? "")) {
        const phoneNoPlus = lead.whatsapp_normalized.replace(/^\+/, "");
        const waLink = `https://api.whatsapp.com/send?phone=${phoneNoPlus}&text=${encodeURIComponent(waText)}`;
        // Dedupe: no duplicar si ya hay pending abierto para este lead + kind
        const existing = await sb
          .from("lead_timeline")
          .select("id")
          .eq("lead_id", lead.id)
          .eq("metadata->>kind", "wa_manual_pending")
          .eq("metadata->>original_kind", "trial_confirmation")
          .is("metadata->sent_manual_at", null)
          .gte("timestamp", new Date(Date.now() - 24 * 3600_000).toISOString())
          .limit(1);
        if ((existing.data?.length ?? 0) === 0) {
          await sb.from("lead_timeline").insert({
            lead_id: lead.id,
            type:    "agent_note",
            author:  "system",
            content: `📋 WA confirmación bloqueado (${r.reason}) — preparado para envío manual`,
            metadata: {
              kind: "wa_manual_pending",
              channel: "whatsapp",
              original_kind: "trial_confirmation",
              phone: lead.whatsapp_normalized,
              text: waText,
              wa_link: waLink,
              reason: r.reason,
              class_id: c.id,
            },
          });
        }
      }
      // Si exists:false (número sin WA), auto-NULL whatsapp_normalized
      // vía handleWaPermanentFail (patrón ya usado en demás crons).
      if (!r.ok && /exists.*false/i.test(r.reason ?? "")) {
        const { handleWaPermanentFail } = await import("@/lib/wa-permanent-fail");
        await handleWaPermanentFail(sb, {
          leadId: lead.id, phone: lead.whatsapp_normalized,
          kind: "trial_confirmation", reason: r.reason, context: "send-trial-notifications",
        }).catch(() => {});
      }
    }

    // Rollback del lock si TODO falló. Fix 2026-08-11 tras 15+
    // trial_confirmation perdidos por night_gate: si tanto email como
    // WA fallaron, dejar notified_at=NULL para que el próximo tick
    // reintente. Si al menos uno OK, mantenemos el lock (no queremos
    // reenviar el que sí funcionó).
    // Post 2026-11-14: con WA desactivado, solo depende del email.
    const bothFailed = emailOk === false && waOk === false;
    const noneAttempted = !lead.email && !lead.whatsapp_normalized;
    if (bothFailed || (waOk === false && !lead.email) || (emailOk === false && !lead.whatsapp_normalized)) {
      await sb.from("classes").update({ notified_at: null }).eq("id", c.id).then(() => {}, () => {});
      console.warn(`[send-trial-notifications] rollback notified_at para ${c.id} — ambos canales fallaron`);
    }

    results.push({ classId: c.id, email: emailOk, wa: waOk, paid });
    if (bothFailed || noneAttempted) console.log(`[send-trial-notifications] ${c.id} rolled back for retry`);
  }

  const wa_retried = await retryPendingWhatsappConfirmations(sb).catch(() => 0);

  // Sesiones de Plan (closers) comparten este cron (2026-08-13)
  const sesiones = await sendSesionConfirmations(sb).catch(() => 0);

  return NextResponse.json({ ok: true, processed: results.length, results, wa_retried, sesiones });
}

const CLASS_SELECT = `
  id, scheduled_at, duration_minutes, short_code, lead_id, teacher_id,
  title, deposit_paid_at, notes_admin,
  lead:leads!inner(id, name, email, whatsapp_normalized, language, german_level, goal, landing_intent, reserva_prioritaria, qualification_answers),
  teacher:teachers!classes_teacher_id_fkey!inner(users!inner(full_name, email))
`;

type ClassRow = {
  id: string; scheduled_at: string; duration_minutes: number | null;
  short_code: string | null; lead_id: string; teacher_id: string;
  title: string | null; deposit_paid_at: string | null; notes_admin: string | null;
  lead: { id: string; name: string | null; email: string | null;
          whatsapp_normalized: string | null; language: "es" | "de" | null;
          german_level: string | null; goal: string | null;
          landing_intent: string | null; reserva_prioritaria: boolean | null;
          qualification_answers: Record<string, string> | null; } |
        Array<{ id: string; name: string | null; email: string | null;
                whatsapp_normalized: string | null; language: "es" | "de" | null;
                german_level: string | null; goal: string | null;
                landing_intent: string | null; reserva_prioritaria: boolean | null;
                qualification_answers: Record<string, string> | null; }>;
  teacher: { users: { full_name: string | null; email: string } |
                     Array<{ full_name: string | null; email: string }> } |
           Array<{ users: { full_name: string | null; email: string } |
                          Array<{ full_name: string | null; email: string }> }>;
};

const flat = <T,>(x: T | T[] | null | undefined): T | null =>
  !x ? null : Array.isArray(x) ? x[0] ?? null : x;

const WA_PENDING_TAG = "[trial_confirmation_wa_pending]";

/** Fallos de WA que no se arreglan reintentando. */
function isPermanentWaFailure(reason: string | undefined): boolean {
  const r = reason ?? "";
  return r === "no_whatsapp_on_lead" || r === "blocklisted"
    || r.startsWith("recent_duplicate") || /"exists"\s*:\s*false/.test(r);
}

function buildConfirmationWa(a: { leadFirst: string; startDate: string }): string {
  // Gelfis 2026-11-15: copy minimalista post-bans. Sin enlace (va por
  // email), sin re-venta. Lead confirma por aquí; detalles al correo.
  return [
    `Hola ${a.leadFirst} 👋`,
    ``,
    `Soy Stiv de la academia Aprender-Aleman.de`,
    `Tu clase de prueba quedó agendada:`,
    ``,
    `📅 ${a.startDate}`,
    ``,
    `Esto es lo que va a pasar:`,
    ``,
    `En la clase (40 min): tu profe te hará una prueba de nivel corta y te dará un plan personalizado para que alcances tus objetivos con el alemán — sabrás exactamente cuántas clases necesitas, qué vas a aprender en cada una y en cuánto tiempo.`,
    ``,
    `Ahora: revisa tu correo. Ahí tienes el enlace del aula virtual.`,
    ``,
    `¿Me confirmas por favor que podrás conectarte a la clase? 🙌`,
  ].join("\n");
}

/**
 * Reintenta SOLO el WhatsApp de confirmación de las clases marcadas con
 * WA_PENDING_TAG (email ya enviado, WA falló por algo pasajero). Corre cada
 * 10 min para no martillear una instancia caída; sin timeline en cada fallo
 * (sería una entrada por minuto). Deja de intentar cuando faltan <30 min
 * para la clase: ahí ya cubren los recordatorios.
 */
async function retryPendingWhatsappConfirmations(_sb: ReturnType<typeof supabaseAdmin>): Promise<number> {
  // Gelfis 2026-11-14 (email-first): la vía WA de trial_confirmation
  // quedó desactivada. Este retry también se apaga — nada nuevo entra
  // a la cola. Dejar la función por compat (se llama desde el handler
  // principal), pero devuelve 0 siempre.
  //
  // Para reactivar: ver histórico pre commit e58c79a (retry con cap/night-gate
  // y reintento por sendWhatsappText(kind=trial_confirmation)).
  return 0;
}

/**
 * Helper: mapea la respuesta del wizard /meta-ads-paid a un label
 * legible para inyectar en los mensajes ("mejorar tu trabajo",
 * "tu Ausbildung"…). Fallback genérico si el lead no completó el
 * paso 1 o si el goal es distinto.
 */
function qualificationGoalLabel(goal: string | null | undefined): string {
  switch (goal) {
    case "job":         return "mejorar tu trabajo";
    case "ausbildung":  return "tu Ausbildung o estudios";
    case "citizenship": return "la nacionalidad y trámites";
    case "daily_life":  return "tu día a día en alemán";
    case "moving":      return "tu mudanza a Alemania/Suiza";
    default:            return "tus objetivos con el alemán";
  }
}
