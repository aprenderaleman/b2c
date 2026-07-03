import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { sendTrialConfirmationEmail } from "@/lib/email/send";
import { sendWhatsappText } from "@/lib/whatsapp";
import { buildEmailActionUrl } from "@/lib/email-action-token";
import { buildLeadJoinUrl } from "@/lib/trial-token";
import { buildTrialIcs } from "@/lib/ics";

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
 *     prioritaria" con [PLACEHOLDER_STRIPE_DEPOSITO_10].
 *
 * Auth: Bearer CRON_SECRET o X-Cron-Secret.
 */

export const runtime  = "nodejs";
export const dynamic  = "force-dynamic";

const PLATFORM_URL = (process.env.PLATFORM_URL ?? "https://b2c.aprender-aleman.de").replace(/\/$/, "");

// [PLACEHOLDER_STRIPE_DEPOSITO_10] — reemplazar por el link del
// Payment Link real de Stripe (10€ depósito). Se pega tal cual en los
// mensajes al lead cuando aún no ha pagado.
const STRIPE_DEPOSIT_URL = process.env.NEXT_PUBLIC_STRIPE_DEPOSIT_URL
  ?? "https://buy.stripe.com/PLACEHOLDER_STRIPE_DEPOSITO_10";

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
      id, scheduled_at, duration_minutes, short_code, lead_id, teacher_id,
      title, deposit_paid_at,
      lead:leads!inner(id, name, email, whatsapp_normalized, language, german_level, goal),
      teacher:teachers!inner(users!inner(full_name, email))
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
    return NextResponse.json({ ok: true, processed: 0 });
  }

  type ClassRow = {
    id: string; scheduled_at: string; duration_minutes: number | null;
    short_code: string | null; lead_id: string; teacher_id: string;
    title: string | null; deposit_paid_at: string | null;
    lead: { id: string; name: string | null; email: string | null;
            whatsapp_normalized: string | null; language: "es" | "de" | null;
            german_level: string | null; goal: string | null; } |
          Array<{ id: string; name: string | null; email: string | null;
                  whatsapp_normalized: string | null; language: "es" | "de" | null;
                  german_level: string | null; goal: string | null; }>;
    teacher: { users: { full_name: string | null; email: string } |
                       Array<{ full_name: string | null; email: string }> } |
             Array<{ users: { full_name: string | null; email: string } |
                            Array<{ full_name: string | null; email: string }> }>;
  };
  const flat = <T,>(x: T | T[] | null | undefined): T | null =>
    !x ? null : Array.isArray(x) ? x[0] ?? null : x;

  const results: Array<{ classId: string; email: boolean; wa: boolean | null; paid: boolean }> = [];

  for (const rawCls of (pending as ClassRow[])) {
    const c = rawCls;
    const lead = flat(c.lead);
    if (!lead) continue;
    const teacherWrap = flat(c.teacher);
    const tu = teacherWrap ? flat(teacherWrap.users) : null;
    const teacherName = tu?.full_name ?? tu?.email ?? "tu profesor/a";

    const language: "es" | "de" = lead.language === "de" ? "de" : "es";
    const leadFirst = (lead.name ?? "").trim().split(/\s+/)[0] || (lead.name ?? "");
    const durationMin = c.duration_minutes ?? 30;
    const paid = !!c.deposit_paid_at;

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
        `Reserva una sesión individual de 30 minutos con un profesor bilingüe experto. Analizaremos tu nivel, definiremos tus objetivos y vivirás la experiencia de nuestra metodología.\n\n` +
        `Aula virtual: ${joinUrl}\n\n` +
        `Importante: al abrir el enlace tu navegador te pedirá permiso para micrófono y cámara — pulsa "Permitir".`,
      organizerName:  "Aprender-Aleman.de",
      organizerEmail: "info@aprender-aleman.de",
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

    // WhatsApp
    let waOk: boolean | null = null;
    if (lead.whatsapp_normalized) {
      const depositLine = paid
        ? "" // ya pagó, no repitas
        : (language === "de"
            ? `\n\n💡 Sichere deinen Platz mit einer 10€-Anzahlung (wird 10€ Guthaben in deinem Paket): ${STRIPE_DEPOSIT_URL}`
            : `\n\n💡 Asegura tu plaza como prioritaria con 10€ (se convierten en 10€ de crédito para tu pack): ${STRIPE_DEPOSIT_URL}`);
      const paidLine = paid
        ? (language === "de"
            ? `\n\n✅ Deine Anzahlung ist eingegangen — dein Platz ist gesichert.`
            : `\n\n✅ Depósito recibido — tu plaza está asegurada. ¡Nos vemos en clase!`)
        : "";
      const waText = language === "de"
        ? `Hallo ${leadFirst}! Ich bin Stiv von der Akademie Aprender-Aleman.de 👋\n\nDeine Deutsch-Probestunde ist gebucht für\n${startDate}.\n\n🔗 Hier kommst du am Tag der Stunde rein:\n${joinUrl}${paidLine}${depositLine}\n\n— Stiv · Aprender-Aleman.de`
        : `¡Hola ${leadFirst}! Soy Stiv de la academia Aprender-Aleman.de 👋\n\nTu clase de alemán está agendada para\n${startDate}.\n\n🔗 Aquí entras el día de la clase:\n${joinUrl}${paidLine}${depositLine}\n\n— Stiv · Aprender-Aleman.de`;

      const r = await sendWhatsappText(lead.whatsapp_normalized, waText, { kind: "trial_confirmation" });
      waOk = r?.ok ?? false;
      await sb.from("lead_timeline").insert({
        lead_id: lead.id,
        type:    waOk ? "system_message_sent" : "send_failed",
        author:  "system",
        content: waOk
          ? waText
          : `💬 Falló el WhatsApp: ${(r as { reason?: string } | null)?.reason ?? "unknown"}`,
        metadata: { channel: "whatsapp", kind: paid ? "trial_confirmation_paid" : "trial_confirmation", class_id: c.id, sent_to: lead.whatsapp_normalized },
      });
    }

    // Marcar notified idempotentemente
    await sb.from("classes")
      .update({ notified_at: new Date().toISOString() })
      .eq("id", c.id);

    results.push({ classId: c.id, email: emailOk, wa: waOk, paid });
  }

  return NextResponse.json({ ok: true, processed: results.length, results });
}
