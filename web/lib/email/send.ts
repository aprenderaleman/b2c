import { fromAddress, getResend, getSmtp, emailBackendConfigured } from "./client";
import { renderWelcomeStudent, type WelcomeStudentVars } from "./templates/welcome-student";
import {
  renderPostTrialFollowup, renderPostTrialFollowupGeneric, renderPostTrialFinal,
  type PostTrialFollowupVars, type PostTrialFollowupGenericVars, type PostTrialFinalVars,
} from "./templates/post-trial-followup";
import { renderWelcomeStaff,   type WelcomeStaffVars }   from "./templates/welcome-staff";
import { renderTeacherInvitation, type TeacherInvitationVars } from "./templates/teacher-invitation";
import { renderTeacherWelcomeSetPassword, type TeacherWelcomeSetPasswordVars } from "./templates/teacher-welcome-setpassword";
import { renderPasswordReset,  type PasswordResetVars }  from "./templates/password-reset";
import { renderDailyDigest,    type DailyDigestVars }    from "./templates/daily-digest";
import {
  renderTeacherPlatformAnnouncement,
  type PlatformAnnouncementVars,
} from "./templates/teacher-platform-announcement";
import {
  renderClassReminder30m,
  type ClassReminder30mVars,
} from "./templates/class-reminder-30m";
import {
  renderTrialConfirmation,
  type TrialConfirmationVars,
} from "./templates/trial-confirmation";
import {
  renderTrialReminder,
  type TrialReminderVars,
} from "./templates/trial-reminder";
import {
  renderTrialAttendedFollowup,
  type TrialAttendedFollowupVars,
} from "./templates/trial-attended-followup";
import {
  renderTrialAbsentFollowup,
  type TrialAbsentFollowupVars,
} from "./templates/trial-absent-followup";
import {
  renderTrialCancelled,
  type TrialCancelledVars,
} from "./templates/trial-cancelled";
import {
  renderClassLifecycle,
  type ClassLifecycleVars,
} from "./templates/class-lifecycle";
import {
  renderClassScheduleSummary,
  type ClassScheduleSummaryVars,
} from "./templates/class-schedule-summary";
import {
  renderTrialRescheduled,
  type TrialRescheduledVars,
} from "./templates/trial-rescheduled";
import {
  renderGroupAdded,
  type GroupAddedVars,
} from "./templates/group-added";
import {
  renderTeacherInvoicePaid,
  type TeacherInvoicePaidVars,
} from "./templates/teacher-invoice-paid";
import {
  renderWelcomePlatform,
  type WelcomePlatformVars,
} from "./templates/welcome-platform";
import {
  renderDiagnosticoWelcome,
  type DiagnosticoWelcomeVars,
} from "./templates/diagnostico-welcome";
import {
  renderDiagnosticoFollowup,
  type DiagnosticoFollowupVars,
} from "./templates/diagnostico-followup";
import {
  renderEmailOnlyNudge,
  type EmailOnlyNudgeVars,
} from "./templates/email-only-nudge";
import {
  renderDiagnosticoFollowupPdf,
  type DiagnosticoFollowupPdfVars,
} from "./templates/diagnostico-followup-pdf";
import {
  renderDiagnosticoTestFollowup,
  type DiagnosticoTestFollowupVars,
} from "./templates/diagnostico-test-followup";
import {
  renderTrialAssignedTeacher,
  type TrialAssignedTeacherVars,
} from "./templates/trial-assigned-teacher";
import {
  renderCloserDailyDigest,
  type CloserDailyDigestVars,
} from "./templates/closer-daily-digest";
import {
  renderVentaPendiente,
  type VentaPendienteVars,
} from "./templates/venta-pendiente";
import {
  renderRankChange,
  type RankChangeVars,
} from "./templates/rank-change";

export type SendResult =
  | { ok: true; id: string | null }
  | { ok: false; error: string };

/**
 * Optional attachments passed to sendRaw. Resend and SMTP both accept
 * the same shape (filename + Buffer), so we normalise on this single
 * type and translate per-backend at the send site.
 */
export type EmailAttachment = {
  filename:     string;
  content:      Buffer;
  contentType?: string;
};

/**
 * Master switch for lifecycle emails (group-added, class-created,
 * class-rescheduled, class-cancelled). Off by default until the
 * admin verifies the new flows end-to-end. Flip on by setting
 * LIFECYCLE_EMAILS_ENABLED=true in Vercel env.
 *
 * Critical mailings (trial-confirmation to leads, password reset,
 * daily digest, etc.) are NOT gated by this flag.
 */
export function lifecycleEmailsEnabled(): boolean {
  // Gelfis 2026-06-23: default a true (antes false). Razón: el email
  // "Tus clases están agendadas" al estudiante es parte del flujo
  // estándar tras convertir lead → student y agendar — no debería
  // estar opt-in. Para desactivar, setear LIFECYCLE_EMAILS_ENABLED=false
  // explícitamente.
  return (process.env.LIFECYCLE_EMAILS_ENABLED ?? "true") === "true";
}

// Backoff entre reintentos por proveedor: 2s, 8s, 30s.
const RETRY_DELAYS_MS = [2_000, 8_000, 30_000];

/**
 * Chequea si el destinatario tiene email_status="bounced" o "complained"
 * en leads. Si sí, retorna true → sendRaw aborta sin intentar.
 *
 * Cache 60s para no martillar la BD en bursts (drips, broadcasts).
 * Si el lead no está en BD (estudiante/admin/profesor) devolvemos
 * false (sigue intentando — esos canales no están en leads).
 */
const _bouncedCache = new Map<string, { v: boolean; ts: number }>();
const BOUNCED_TTL_MS = 60_000;

async function isRecipientBounced(to: string): Promise<boolean> {
  const email = to.toLowerCase().trim();
  if (!email) return false;
  const cached = _bouncedCache.get(email);
  if (cached && Date.now() - cached.ts < BOUNCED_TTL_MS) return cached.v;
  try {
    const { supabaseAdmin } = await import("../supabase");
    const sb = supabaseAdmin();
    const { data } = await sb
      .from("leads")
      .select("email_status")
      .ilike("email", email)
      .maybeSingle();
    const status = (data as { email_status?: string } | null)?.email_status ?? null;
    const v = status === "bounced" || status === "complained";
    _bouncedCache.set(email, { v, ts: Date.now() });
    return v;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * ¿El error retornado por un proveedor justifica un retry? Solo
 * para errores transitorios (5xx, timeout, network); permanentes
 * (400, invalid_to, dominio rebote) NO se reintentan.
 */
function isTransient(err: string): boolean {
  const e = err.toLowerCase();
  return (
    e.includes("timeout") ||
    e.includes("timed out") ||
    e.includes("etimedout") ||
    e.includes("econnreset") ||
    e.includes("econnrefused") ||
    e.includes("network") ||
    e.includes("socket") ||
    e.includes("503") ||
    e.includes("502") ||
    e.includes("504") ||
    e.includes("500 ") ||
    e.includes("rate_limit") ||
    e.includes("too many requests") ||
    e.includes("temporarily") ||
    e.includes("try again")
  );
}

async function sendViaResend(
  to: string, subject: string, html: string, text: string,
  attachments?: EmailAttachment[],
): Promise<SendResult> {
  const resend = getResend();
  if (!resend) return { ok: false, error: "resend_not_configured" };
  try {
    const { data, error } = await resend.emails.send({
      from: fromAddress(), to, subject, html, text,
      ...(attachments && attachments.length > 0
        ? { attachments: attachments.map(a => ({ filename: a.filename, content: a.content })) }
        : {}),
    });
    if (error) return { ok: false, error: error.message ?? "resend error" };
    return { ok: true, id: data?.id ?? null };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}

async function sendViaSmtp(
  to: string, subject: string, html: string, text: string,
  attachments?: EmailAttachment[],
): Promise<SendResult> {
  const smtp = getSmtp();
  if (!smtp) return { ok: false, error: "smtp_not_configured" };
  try {
    const info = await smtp.sendMail({
      from: fromAddress(), to, subject, html, text,
      ...(attachments && attachments.length > 0
        ? { attachments: attachments.map(a => ({
            filename:    a.filename,
            content:     a.content,
            contentType: a.contentType,
          })) }
        : {}),
    });
    return { ok: true, id: info.messageId ?? null };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "smtp error" };
  }
}

/**
 * Intenta un proveedor con backoff 2s/8s/30s para errores transitorios.
 * Errores permanentes (validación, dominio rebote) cortan inmediato.
 */
async function trySendWithBackoff(
  send: () => Promise<SendResult>,
  label: string,
): Promise<SendResult> {
  let last: SendResult = { ok: false, error: `${label}_no_attempts` };
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    last = await send();
    if (last.ok) return last;
    if (!isTransient(last.error)) return last;
    if (attempt < RETRY_DELAYS_MS.length) {
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }
  return last;
}

/**
 * Low-level send. Política:
 *  1. Intenta Resend con retry+backoff (4 intentos, 2s/8s/30s).
 *  2. Si Resend queda en error (transitorio agotado o config faltante),
 *     intenta SMTP también con retry+backoff.
 *  3. Si ambos fallan o no hay backend, loguea y devuelve error.
 *
 * Sin retries para errores permanentes (400, dominio inválido, etc.)
 * porque no van a mejorar reintentando — desperdiciaría latencia.
 *
 * Hasta 2026-06-25 la lógica era "Resend O SMTP" sin fallback ni retry,
 * lo cual dejaba huecos en cuanto Resend tenía cualquier hipo.
 */
export async function sendRaw(
  to: string,
  subject: string,
  html: string,
  text: string,
  attachments?: EmailAttachment[],
): Promise<SendResult> {
  // Skip si el destinatario está marcado como bounced/complained
  // por el webhook Resend — protege la reputación del dominio.
  if (await isRecipientBounced(to)) {
    return { ok: false, error: "recipient_email_bounced" };
  }

  const hasResend = !!getResend();
  const hasSmtp   = !!getSmtp();

  // --- Sin backend configurado: log + pretend-success ---
  if (!hasResend && !hasSmtp) {
    console.log("=".repeat(60));
    console.log(`[email DEV] to=${to}`);
    console.log(`[email DEV] subject=${subject}`);
    console.log(`[email DEV] text=\n${text}`);
    if (attachments && attachments.length > 0) {
      console.log(`[email DEV] attachments=${attachments.map(a => `${a.filename} (${a.content.length}B)`).join(", ")}`);
    }
    console.log("=".repeat(60));
    return { ok: true, id: null };
  }

  // --- 1. Resend con retry ---
  if (hasResend) {
    const r = await trySendWithBackoff(
      () => sendViaResend(to, subject, html, text, attachments),
      "resend",
    );
    if (r.ok) return r;
    console.warn(`[email] Resend falló (${r.error}). ${hasSmtp ? "Failover SMTP." : "Sin SMTP configurado."}`);
  }

  // --- 2. SMTP fallback con retry ---
  if (hasSmtp) {
    const s = await trySendWithBackoff(
      () => sendViaSmtp(to, subject, html, text, attachments),
      "smtp",
    );
    return s;
  }

  return { ok: false, error: "all_email_backends_failed" };
}

/**
 * Send the "welcome to the academy" email after a lead is converted
 * to a student. Renders the template in the student's preferred language.
 */
export async function sendWelcomeStudentEmail(
  to: string,
  vars: WelcomeStudentVars,
  attachments?: EmailAttachment[],
): Promise<SendResult> {
  const { subject, html, text } = renderWelcomeStudent(vars);
  return sendRaw(to, subject, html, text, attachments);
}

/**
 * Email espejo del WhatsApp post-clase de prueba — el mismo wording
 * con un botón clickable al checkout del pack. Disparado desde
 * `markTrialAttendedAwaitingConversion` cuando el admin marca "Asistió".
 */
export async function sendPostTrialFollowupEmail(
  to: string,
  vars: PostTrialFollowupVars,
): Promise<SendResult> {
  const { subject, html, text } = renderPostTrialFollowup(vars);
  return sendRaw(to, subject, html, text);
}

/**
 * Variante genérica del email post-clase, cuando el admin no rellenó
 * el modal con pack/objetivo. Mismo wording que la versión genérica
 * de WhatsApp ("¿Qué te pareció?…").
 */
export async function sendPostTrialFollowupGenericEmail(
  to: string,
  vars: PostTrialFollowupGenericVars,
): Promise<SendResult> {
  const { subject, html, text } = renderPostTrialFollowupGeneric(vars);
  return sendRaw(to, subject, html, text);
}

/**
 * Email del Mensaje 3 — último de la cadena post-clase de prueba.
 * Coincide con el WhatsApp final ("liberamos tu espacio"). No incluye
 * link.
 */
export async function sendPostTrialFinalEmail(
  to: string,
  vars: PostTrialFinalVars,
): Promise<SendResult> {
  const { subject, html, text } = renderPostTrialFinal(vars);
  return sendRaw(to, subject, html, text);
}

/**
 * Send the "welcome to the team" email for a newly-created admin or teacher.
 */
export async function sendWelcomeStaffEmail(
  to: string,
  vars: WelcomeStaffVars,
): Promise<SendResult> {
  const { subject, html, text } = renderWelcomeStaff(vars);
  return sendRaw(to, subject, html, text);
}

/**
 * Invitación a candidato a profesor con su link único de registro.
 */
export async function sendTeacherInvitationEmail(
  to: string,
  vars: TeacherInvitationVars,
): Promise<SendResult> {
  const { subject, html, text } = renderTeacherInvitation(vars);
  return sendRaw(to, subject, html, text);
}

/**
 * Bienvenida al profesor aprobado con enlace de creación de contraseña
 * (sin contraseña temporal en texto plano).
 */
export async function sendTeacherWelcomeSetPasswordEmail(
  to: string,
  vars: TeacherWelcomeSetPasswordVars,
): Promise<SendResult> {
  const { subject, html, text } = renderTeacherWelcomeSetPassword(vars);
  return sendRaw(to, subject, html, text);
}

/**
 * Send the "reset your password" email with a one-hour signed link.
 */
export async function sendPasswordResetEmail(
  to: string,
  vars: PasswordResetVars,
): Promise<SendResult> {
  const { subject, html, text } = renderPasswordReset(vars);
  return sendRaw(to, subject, html, text);
}

/**
 * Send the daily digest email to admin (Gelfis).
 */
export async function sendDailyDigestEmail(
  to: string,
  vars: DailyDigestVars,
): Promise<SendResult> {
  const { subject, html, text } = renderDailyDigest(vars);
  return sendRaw(to, subject, html, text);
}

/**
 * One-off: "the new platform is live" announcement to a teacher.
 * Triggered from /admin/broadcast the week of the Zoom cutover.
 */
export async function sendTeacherPlatformAnnouncement(
  to: string,
  vars: PlatformAnnouncementVars,
): Promise<SendResult> {
  const { subject, html, text } = renderTeacherPlatformAnnouncement(vars);
  return sendRaw(to, subject, html, text);
}

/**
 * Pre-class reminder, ~30 min before start. Single notification per
 * class (no WhatsApp, no second window) — used by the
 * /api/cron/class-reminders job.
 */
export async function sendClassReminder30mEmail(
  to: string,
  vars: ClassReminder30mVars,
): Promise<SendResult> {
  const { subject, html, text } = renderClassReminder30m(vars);
  return sendRaw(to, subject, html, text);
}

import { renderClassMorningSummary, type ClassMorningVars } from "./templates/class-morning-summary";
export async function sendClassMorningSummaryEmail(
  to: string,
  vars: ClassMorningVars,
): Promise<SendResult> {
  const { subject, html, text } = renderClassMorningSummary(vars);
  return sendRaw(to, subject, html, text);
}

/**
 * Trial-class booking confirmation. Sent the moment the lead picks
 * a slot in the public funnel. Includes the magic-link aula URL.
 */
export async function sendTrialConfirmationEmail(
  to: string,
  vars: TrialConfirmationVars,
  /** Optional .ics attachment so the lead can add the trial to their
   *  own calendar with one click. Built by lib/ics.ts in book-trial. */
  ics?: { content: Buffer | string; filename?: string },
): Promise<SendResult> {
  // Runtime guard contra el bug "lead recibe bare /aula/{id}".
  // El tipo `joinUrl: LeadJoinUrl` ya lo protege en compile-time;
  // este es defensa adicional contra `as LeadJoinUrl` casts.
  const { assertLeadJoinUrl } = await import("@/lib/trial-token");
  assertLeadJoinUrl(vars.joinUrl, "sendTrialConfirmationEmail");
  const { subject, html, text } = renderTrialConfirmation(vars);
  const attachments: EmailAttachment[] | undefined = ics
    ? [{
        filename:    ics.filename ?? "clase-de-prueba.ics",
        content:     typeof ics.content === "string" ? Buffer.from(ics.content, "utf-8") : ics.content,
        contentType: "text/calendar; method=REQUEST; charset=UTF-8",
      }]
    : undefined;
  return sendRaw(to, subject, html, text, attachments);
}

/**
 * Pre-class reminder for a trial. Used by both the 24h-before and 8 AM
 * same-day Vercel cron jobs, for both the lead and the teacher (the
 * `audience` field on `vars` flips the copy/subject accordingly).
 */
export async function sendTrialReminderEmail(
  to: string,
  vars: TrialReminderVars,
): Promise<SendResult> {
  // Runtime guard: el template comparte tipo entre lead/teacher así
  // que joinUrl es string genérico. Cuando vamos al lead, validamos
  // que NO sea un bare /aula/{id} (que bouncearía a /login). Bug
  // recurrente — ver lib/trial-token.ts assertLeadJoinUrl.
  if (vars.audience === "lead") {
    const { assertLeadJoinUrl } = await import("@/lib/trial-token");
    assertLeadJoinUrl(vars.joinUrl, "sendTrialReminderEmail/lead");
  }
  const { subject, html, text } = renderTrialReminder(vars);
  return sendRaw(to, subject, html, text);
}

/**
 * Email post-trial cuando el lead asistio. Disparado por
 * `markTrialAttended` (con pack URL como ctaUrl) y por
 * `markTrialAttendedNoLink` (con /inscripciones como ctaUrl).
 */
export async function sendTrialAttendedFollowupEmail(
  to: string,
  vars: TrialAttendedFollowupVars,
): Promise<SendResult> {
  const { subject, html, text } = renderTrialAttendedFollowup(vars);
  return sendRaw(to, subject, html, text);
}

/**
 * Email cuando el profesor marca al lead como "No asistió". Botón
 * principal lleva a /agendar/cuando con su lead_id pre-rellenado.
 */
export async function sendTrialAbsentFollowupEmail(
  to: string,
  vars: TrialAbsentFollowupVars,
): Promise<SendResult> {
  const { subject, html, text } = renderTrialAbsentFollowup(vars);
  return sendRaw(to, subject, html, text);
}

/**
 * Email cuando profesor / admin / superadmin cancela una clase de
 * prueba. Botón principal lleva a /agendar/cuando para retomar.
 */
export async function sendTrialCancelledEmail(
  to: string,
  vars: TrialCancelledVars,
): Promise<SendResult> {
  const { subject, html, text } = renderTrialCancelled(vars);
  return sendRaw(to, subject, html, text);
}

/**
 * Aviso al lead de que admin/Stiv ha cambiado fecha/hora de su trial.
 * Envío directo (no gated por LIFECYCLE_EMAILS_ENABLED) — el lead
 * tiene que saberlo si o si para que no se quede sin asistir.
 */
export async function sendTrialRescheduledEmail(
  to: string,
  vars: TrialRescheduledVars,
): Promise<SendResult> {
  const { assertLeadJoinUrl } = await import("@/lib/trial-token");
  assertLeadJoinUrl(vars.joinUrl, "sendTrialRescheduledEmail");
  const { subject, html, text } = renderTrialRescheduled(vars);
  return sendRaw(to, subject, html, text);
}

/**
 * Class-lifecycle event email — used when a teacher / admin creates,
 * reschedules or cancels a class for an active account (student or
 * teacher). Replaces the WhatsApp pings that used to fire from the
 * /api/teacher/classes and /api/admin/classes routes.
 */
export async function sendClassLifecycleEmail(
  to: string,
  vars: ClassLifecycleVars,
): Promise<SendResult> {
  const { subject, html, text } = renderClassLifecycle(vars);
  return sendRaw(to, subject, html, text);
}

/**
 * Email "resumen de clases agendadas" — un solo correo cuando el
 * profesor agenda múltiples slots desde el modal flexible de
 * /api/teacher/classes/bulk (Gelfis 2026-06-23).
 */
export async function sendClassScheduleSummaryEmail(
  to: string,
  vars: ClassScheduleSummaryVars,
): Promise<SendResult> {
  const { subject, html, text } = renderClassScheduleSummary(vars);
  return sendRaw(to, subject, html, text);
}

/**
 * One-shot summary email when a student is added to a class group.
 * Says "you got N upcoming classes, here's the next one" so the
 * student doesn't get spammed with N inheritance emails.
 */
export async function sendGroupAddedEmail(
  to: string,
  vars: GroupAddedVars,
): Promise<SendResult> {
  const { subject, html, text } = renderGroupAdded(vars);
  return sendRaw(to, subject, html, text);
}

/**
 * "Te hemos pagado X" email + the monthly invoice PDF as attachment.
 * Triggered when admin marks a teacher_earnings row as paid on
 * /admin/finanzas/profesores. Transactional — NOT gated by the
 * lifecycle-emails flag (the teacher needs to know they got paid).
 */
export async function sendTeacherInvoicePaidEmail(
  to: string,
  vars: TeacherInvoicePaidVars,
  pdf: { filename: string; content: Buffer },
): Promise<SendResult> {
  const { subject, html, text } = renderTeacherInvoicePaid(vars);
  return sendRaw(to, subject, html, text, [
    { filename: pdf.filename, content: pdf.content, contentType: "application/pdf" },
  ]);
}


/**
 * "Bienvenido a la plataforma" — email manual disparado por admin desde
 * /admin/usuarios cuando un alumno aún no ha entrado. Combina link de
 * establecer contraseña + tour rápido del dashboard. Transactional — no
 * gated por LIFECYCLE_EMAILS_ENABLED.
 */
export async function sendWelcomePlatformEmail(
  to: string,
  vars: WelcomePlatformVars,
): Promise<SendResult> {
  const { subject, html, text } = renderWelcomePlatform(vars);
  return sendRaw(to, subject, html, text);
}

/**
 * Email transaccional disparado al completar el paso 5 del nuevo
 * funnel `/diagnostico` (root). Bridge entre "creó plan" y "agendó
 * clase" — si abandonan, este email queda como punto de regreso.
 */
export async function sendDiagnosticoWelcomeEmail(
  to: string,
  vars: DiagnosticoWelcomeVars,
): Promise<SendResult> {
  const { subject, html, text } = renderDiagnosticoWelcome(vars);
  return sendRaw(to, subject, html, text);
}

/**
 * Nudge agresivo para leads que completaron el form pero NO dejaron
 * WhatsApp. Schedule: T+30min, T+6h, T+24h, T+3d, T+7d. Cada uno con
 * subject y copy escalando la urgencia.
 */
export async function sendEmailOnlyNudge(
  to: string,
  vars: EmailOnlyNudgeVars,
): Promise<SendResult> {
  const { subject, html, text } = await renderEmailOnlyNudge(vars);
  return sendRaw(to, subject, html, text);
}

/**
 * Followups del drip de leads abandonados — variante 'reminder_24h'
 * o 'final_7d'. Disparado por `/api/cron/diagnostico-followups`.
 */
export async function sendDiagnosticoFollowupEmail(
  to: string,
  vars: DiagnosticoFollowupVars,
): Promise<SendResult> {
  const { subject, html, text } = renderDiagnosticoFollowup(vars);
  return sendRaw(to, subject, html, text);
}

/**
 * Msg 2 del drip (T+24h) con PDF adjunto adaptado al nivel del lead.
 * El caller pasa el Buffer del PDF (ya descargado de R2) + el nombre
 * del archivo. La adjunción funciona tanto con Resend como con SMTP.
 */
export async function sendDiagnosticoFollowupPdfEmail(
  to: string,
  vars: DiagnosticoFollowupPdfVars,
  pdf: { fileName: string; buffer: Buffer },
): Promise<SendResult> {
  const { subject, html, text } = renderDiagnosticoFollowupPdf(vars);
  return sendRaw(to, subject, html, text, [
    { filename: pdf.fileName, content: pdf.buffer },
  ]);
}

/**
 * Msg 4 del drip (T+3d) — 24h después de invitar al test de nivel.
 * Pregunta si descubrió su nivel + pide hora para llamada hoy/mañana.
 */
export async function sendDiagnosticoTestFollowupEmail(
  to: string,
  vars: DiagnosticoTestFollowupVars,
): Promise<SendResult> {
  const { subject, html, text } = renderDiagnosticoTestFollowup(vars);
  return sendRaw(to, subject, html, text);
}

/**
 * Alerta interna a Gelfis cuando entra un nuevo lead (paso 5 funnel).
 * NO va al lead — destinatario único es la cuenta superadmin (env
 * NEW_LEAD_ALERT_EMAIL). El template tiene un botón directo a WhatsApp.
 */
import { renderLeadNewUrgent, type LeadNewUrgentVars } from "./templates/lead-new-urgent";
export async function sendLeadNewUrgentEmail(
  to: string,
  vars: LeadNewUrgentVars,
): Promise<SendResult> {
  const { subject, html, text } = renderLeadNewUrgent(vars);
  return sendRaw(to, subject, html, text);
}

export async function sendTrialAssignedTeacherEmail(
  to: string,
  vars: TrialAssignedTeacherVars,
): Promise<SendResult> {
  const { subject, html, text } = renderTrialAssignedTeacher(vars);
  return sendRaw(to, subject, html, text);
}

import {
  renderPackCompleted,
  type PackCompletedVars,
} from "./templates/pack-completed";
import {
  renderPackLowBalance,
  type PackLowBalanceVars,
} from "./templates/pack-low-balance";

/**
 * Email when a student completes all classes in their pack.
 * Asks for feedback and prompts them to contact Gelfis for next steps.
 */
export async function sendPackCompletedEmail(
  to: string,
  vars: PackCompletedVars,
): Promise<SendResult> {
  const { subject, html, text } = renderPackCompleted(vars);
  return sendRaw(to, subject, html, text);
}

/**
 * Email when a student has few classes remaining (e.g. 5).
 * Prompts them to contact Gelfis to renew before they run out.
 */
export async function sendPackLowBalanceEmail(
  to: string,
  vars: PackLowBalanceVars,
): Promise<SendResult> {
  const { subject, html, text } = renderPackLowBalance(vars);
  return sendRaw(to, subject, html, text);
}

export async function sendCloserDailyDigestEmail(
  to: string,
  vars: CloserDailyDigestVars,
): Promise<SendResult> {
  const { subject, html, text } = renderCloserDailyDigest(vars);
  return sendRaw(to, subject, html, text);
}

export async function sendVentaPendienteEmail(
  to: string,
  vars: VentaPendienteVars,
): Promise<SendResult> {
  const { subject, html, text } = renderVentaPendiente(vars);
  return sendRaw(to, subject, html, text);
}

export async function sendRankChangeEmail(
  to: string,
  vars: RankChangeVars,
): Promise<SendResult> {
  const { subject, html, text } = renderRankChange(vars);
  return sendRaw(to, subject, html, text);
}
