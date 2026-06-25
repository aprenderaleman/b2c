import { NextResponse } from "next/server";
import {
  sendTrialAttendedFollowupEmail,
  sendTrialAbsentFollowupEmail,
  sendTrialConfirmationEmail,
  sendTrialReminderEmail,
  sendRaw,
} from "@/lib/email/send";
import { buildEmailActionUrl } from "@/lib/email-action-token";
import { getPack, getPackUrlWithOverride } from "@/lib/trial-packs";
import { renderEnvelope, h2, p, button, escapeHtml } from "@/lib/email/templates/base";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/email-samples?to=foo@bar.com
 * Auth: Bearer CRON_SECRET o X-Cron-Secret.
 *
 * Manda al destinatario UNA muestra de cada email nuevo del panel
 * profesor (asistió con/sin pack, no asistió, escalación) + la
 * nueva cadena trial-confirmation y trial-reminder. Útil para
 * revisión visual.
 */
function authd(req: Request): boolean {
  const e = process.env.CRON_SECRET;
  if (!e) return false;
  const b = req.headers.get("authorization");
  if (b && b.toLowerCase().startsWith("bearer ") && b.slice(7).trim() === e) return true;
  return req.headers.get("x-cron-secret") === e;
}

export async function POST(req: Request) {
  if (!authd(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const to = url.searchParams.get("to") || "aprenderaleman2026@gmail.com";

  // IDs ficticios pero firmados con el secret real para que los botones
  // del email lleven a páginas válidas (verán "lead no encontrado").
  const fakeLead = "00000000-0000-0000-0000-000000000aaa";
  const fakeClass = "00000000-0000-0000-0000-000000000bbb";
  const confirmUrl = buildEmailActionUrl({ leadId: fakeLead, classId: fakeClass, action: "confirm" });
  const rescheduleUrl = buildEmailActionUrl({ leadId: fakeLead, classId: fakeClass, action: "reschedule" });
  const joinUrl = "https://b2c.aprender-aleman.de/c/sample123";

  const results: Record<string, unknown> = {};

  // 1) Asistió SIN enlace de pago (CTA = /inscripciones)
  results.attended_no_pack = await sendTrialAttendedFollowupEmail(to, {
    leadName: "Sandra (muestra)",
    language: "es",
    ctaUrl: "https://aprender-aleman.de/inscripciones",
  });

  // 2) Asistió CON enlace de pago — Pack Intermedio flexible
  const pack = getPack("intermedio");
  const stripeUrl = getPackUrlWithOverride("intermedio", "flexible");
  results.attended_with_pack = await sendTrialAttendedFollowupEmail(to, {
    leadName: "Carlos (muestra)",
    language: "es",
    ctaUrl: stripeUrl,
    packName: pack?.name ?? "Pack Intermedio",
  });

  // 3) No asistió — botón a /agendar/cuando
  results.absent = await sendTrialAbsentFollowupEmail(to, {
    leadName: "Omar (muestra)",
    language: "es",
    rescheduleUrl: "https://b2c.aprender-aleman.de/agendar/cuando?lead=" + fakeLead + "&from=trial_absent",
  });

  // 4) Email de confirmación al agendar (nuevo, con botones)
  results.trial_confirmation = await sendTrialConfirmationEmail(to, {
    leadName: "Nadia (muestra)",
    classTitle: "Clase de prueba",
    startDate: "jueves 26 de junio, 17:00 (Berlín)",
    durationMin: 30,
    teacherName: "Stiv",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    joinUrl: joinUrl as any,
    confirmUrl,
    rescheduleUrl,
    language: "es",
  });

  // 5) Recordatorio 24h con botones
  results.reminder_24h = await sendTrialReminderEmail(to, {
    audience: "lead",
    tone: "24h_before",
    recipientName: "Nadia",
    counterpartName: "tu profesor/a",
    startDate: "viernes 27 de junio, 17:00 (Berlín)",
    durationMin: 30,
    joinUrl,
    confirmUrl,
    rescheduleUrl,
    language: "es",
  });

  // 6) Recordatorio mañana
  results.reminder_morning = await sendTrialReminderEmail(to, {
    audience: "lead",
    tone: "morning_of",
    recipientName: "Nadia",
    counterpartName: "tu profesor/a",
    startDate: "hoy a las 17:00 (Berlín)",
    durationMin: 30,
    joinUrl,
    rescheduleUrl,
    language: "es",
  });

  // 7) Email de escalación a admin
  const link = "https://b2c.aprender-aleman.de/admin/leads/" + fakeLead;
  const body = `
    ${h2(`🚨 Escalación de Sabine (muestra)`)}
    ${p(`<strong>Lead:</strong> ${escapeHtml("Lead de muestra")}`)}
    ${p(`<strong>Profesor:</strong> Sabine (muestra)`)}
    ${p(`<strong>Motivo:</strong><br><em>El lead conectó pero el audio no funcionaba y se desconectó. Quiere reagendar pero no responde mensajes.</em>`)}
    <div style="text-align:center;margin:24px 0;">
      ${button(link, "Abrir ficha del lead →")}
    </div>
    ${p(`<em style="color:#64748b;font-size:13px;">El lead ya fue puesto en status=needs_human — todos los flows automáticos están pausados hasta que intervengas.</em>`)}
  `;
  results.escalation = await sendRaw(
    to,
    "🚨 Sabine escaló a Lead de muestra",
    renderEnvelope(body, "Notificación operativa de Aprender-Aleman.de."),
    "Muestra de escalación. Lead: Lead de muestra. Motivo: el lead conectó pero audio no funcionaba.",
  );

  return NextResponse.json({ to, results });
}
