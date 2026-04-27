import { fromAddress, getResend, getSmtp, emailBackendConfigured } from "./client";
import { renderWelcomeStudent, type WelcomeStudentVars } from "./templates/welcome-student";
import { renderWelcomeStaff,   type WelcomeStaffVars }   from "./templates/welcome-staff";
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
  renderClassLifecycle,
  type ClassLifecycleVars,
} from "./templates/class-lifecycle";
import {
  renderGroupAdded,
  type GroupAddedVars,
} from "./templates/group-added";

export type SendResult =
  | { ok: true; id: string | null }
  | { ok: false; error: string };

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
  return (process.env.LIFECYCLE_EMAILS_ENABLED ?? "false") === "true";
}

/**
 * Low-level send. Tries Resend first (if configured), then SMTP (if
 * configured), and finally falls back to logging the email to stdout
 * so dev environments don't break.
 *
 * Returns a SendResult with either the provider's message id (or a
 * synthesised one for SMTP) or a clear error reason.
 */
export async function sendRaw(
  to: string,
  subject: string,
  html: string,
  text: string,
): Promise<SendResult> {
  const backend = emailBackendConfigured();

  // --- 1. Resend ---
  if (backend === "resend") {
    const resend = getResend()!;
    try {
      const { data, error } = await resend.emails.send({
        from: fromAddress(), to, subject, html, text,
      });
      if (error) return { ok: false, error: error.message ?? "resend error" };
      return { ok: true, id: data?.id ?? null };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "unknown" };
    }
  }

  // --- 2. SMTP (nodemailer) ---
  if (backend === "smtp") {
    const smtp = getSmtp()!;
    try {
      const info = await smtp.sendMail({
        from: fromAddress(), to, subject, html, text,
      });
      return { ok: true, id: info.messageId ?? null };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "smtp error" };
    }
  }

  // --- 3. No backend configured: log + pretend-success so dev keeps flowing. ---
  console.log("=".repeat(60));
  console.log(`[email DEV] to=${to}`);
  console.log(`[email DEV] subject=${subject}`);
  console.log(`[email DEV] text=\n${text}`);
  console.log("=".repeat(60));
  return { ok: true, id: null };
}

/**
 * Send the "welcome to the academy" email after a lead is converted
 * to a student. Renders the template in the student's preferred language.
 */
export async function sendWelcomeStudentEmail(
  to: string,
  vars: WelcomeStudentVars,
): Promise<SendResult> {
  const { subject, html, text } = renderWelcomeStudent(vars);
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

/**
 * Trial-class booking confirmation. Sent the moment the lead picks
 * a slot in the public funnel. Includes the magic-link aula URL.
 */
export async function sendTrialConfirmationEmail(
  to: string,
  vars: TrialConfirmationVars,
): Promise<SendResult> {
  const { subject, html, text } = renderTrialConfirmation(vars);
  return sendRaw(to, subject, html, text);
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
  const { subject, html, text } = renderTrialReminder(vars);
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
