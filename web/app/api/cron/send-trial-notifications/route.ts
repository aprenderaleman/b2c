import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { sendTrialConfirmationEmail } from "@/lib/email/send";
// Gelfis 2026-11-14 (email-first): sendWhatsappText retirado — WA auto desactivado en este cron.
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

    // Gelfis 2026-11-14 (email-first post-bans v5+v6): el WhatsApp
    // automático de trial_confirmation se desactiva. Solo email (free,
    // sin riesgo de ban). Si el equipo quiere refuerzo por WA, lo manda
    // manual desde el panel admin o desde la cola del setter.
    //
    // El flujo histórico queda comentado abajo por si se reactiva
    // cuando v6 esté sólido (14+ días warm-up sin fails).
    const waOk: boolean | null = null;
    // if (lead.whatsapp_normalized) {
    //   const waText = buildConfirmationWa({ leadFirst, startDate, joinUrl, vip: isMetaAdsPaid && paid, goalLabel });
    //   const r = await sendWhatsappText(lead.whatsapp_normalized, waText, { kind: "trial_confirmation" });
    //   ...
    // }

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

function buildConfirmationWa(a: { leadFirst: string; startDate: string; joinUrl: string; vip: boolean; goalLabel: string }): string {
  if (a.vip) {
    // Lead VIP (ya pagó la Agenda Prioritaria) → confirmación
    // reconociendo el estado + copy amable estándar.
    return `¡Hola ${a.leadFirst}! Soy Stiv de la academia Aprender-Aleman.de 👋\n\n🌟 Tu Agenda Prioritaria está confirmada para\n${a.startDate}.\n\nTu profesor ya prepara la clase enfocada en ${a.goalLabel}. 🎯\n\n🔗 Aquí entras el día de la clase:\n${a.joinUrl}\n\nResponde CONFIRMO para asegurar tu plaza — y si no puedes asistir, dímelo y te reagendamos sin problema 😊\n\n— Stiv · Aprender-Aleman.de`;
  }
  // Copy estándar único para todos los demás flows (incluye
  // meta-ads-paid sin depósito). Copy actualizado 2026-08-02
  // tras incidente trial-slot-release: eliminada la amenaza
  // "sin tu respuesta en 12h tu slot se libera". Ver
  // docs/no-auto-cancel-policy.md — el sistema NO libera slots
  // por falta de confirmación.
  // Gelfis 2026-11-08 (Hormozi #1): trial_confirmation pasa de puramente
  // logístico a pre-venta encubierta. Añade Dream Outcome ("llegar a tu
  // meta sin perder meses"), explica QUÉ pasa en la clase (reduce
  // ansiedad = menos no-shows) y pide un commitment pequeño (papel y
  // lápiz). Trial son 40 minutos (no 30).
  return `¡Hola ${a.leadFirst}! Soy Stiv de Aprender-Aleman.de 👋\n\nTu clase de prueba quedó agendada para el ${a.startDate} 🗓️\n\nTe cuento qué va a pasar: 40 minutos uno a uno con un profe nativo que habla español. Vais a ver dónde estás hoy en alemán y qué camino te conviene para llegar a tu meta sin perder meses dando vueltas.\n\n🔗 Aquí entras el día de la clase: ${a.joinUrl}\n\nUn consejo que marca la diferencia: ten papel y lápiz a mano para anotar el plan que te preparen 😊\n\nResponde CONFIRMO para asegurar tu plaza — y si no puedes asistir, dímelo y te reagendamos sin problema.\n\n— Stiv · Aprender-Aleman.de`;
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
