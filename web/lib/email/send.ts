import { fromAddress, getResend } from "./client";
import { renderWelcomeStudent, type WelcomeStudentVars } from "./templates/welcome-student";
import { renderWelcomeStaff,   type WelcomeStaffVars }   from "./templates/welcome-staff";
import { renderPasswordReset,  type PasswordResetVars }  from "./templates/password-reset";

export type SendResult =
  | { ok: true; id: string | null }
  | { ok: false; error: string };

/**
 * Low-level send that hides the fact we may not have a Resend key in dev.
 * In that case it logs the rendered email to the server console and
 * returns ok=true so the caller's happy path still runs.
 */
async function sendRaw(
  to: string,
  subject: string,
  html: string,
  text: string,
): Promise<SendResult> {
  const resend = getResend();
  if (!resend) {
    // Dev / CI / missing-key fallback: log instead of sending.
    console.log("=".repeat(60));
    console.log(`[email DEV] to=${to}`);
    console.log(`[email DEV] subject=${subject}`);
    console.log(`[email DEV] text=\n${text}`);
    console.log("=".repeat(60));
    return { ok: true, id: null };
  }

  try {
    const { data, error } = await resend.emails.send({
      from:    fromAddress(),
      to,
      subject,
      html,
      text,
    });
    if (error) return { ok: false, error: error.message ?? "resend error" };
    return { ok: true, id: data?.id ?? null };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
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
