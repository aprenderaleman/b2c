import { supabaseAdmin } from "@/lib/supabase";
import { buildTeacherInvoicePdf } from "@/lib/finance/teacher-invoice-pdf";
import { sendTeacherInvoicePaidEmail } from "@/lib/email/send";

/**
 * Envía el "te hemos pagado" email al profesor + copia archivo al admin.
 *
 * Llamado por:
 *   - /api/admin/finanzas/earnings/[id]/pay  cuando se marca paid=true
 *   - /api/admin/finanzas/earnings/[id]/resend-invoice  para re-disparar
 *     manualmente (caso típico: backend de email no estaba configurado
 *     cuando se marcó pagado).
 *
 * Devuelve un struct con el resultado de cada envío para que el caller
 * pueda mostrar feedback al admin (no swallow silencioso).
 */
export type InvoicePaidSendResult = {
  teacherEmail: { to: string; ok: boolean; error?: string };
  adminEmail:   { to: string; ok: boolean; error?: string } | null;
};

export async function sendInvoicePaidEmails(
  earningsId:       string,
  paymentReference: string | null,
): Promise<InvoicePaidSendResult | null> {
  const sb = supabaseAdmin();

  const { data: earnings } = await sb
    .from("teacher_earnings")
    .select(`
      id, teacher_id, month, amount_cents, currency,
      teacher:teachers!inner(
        users!inner(full_name, email, language_preference)
      )
    `)
    .eq("id", earningsId)
    .maybeSingle();
  if (!earnings) return null;

  const e = earnings as {
    teacher_id: string;
    month:      string;
    amount_cents: number;
    currency:   string;
    teacher: { users: unknown } | Array<{ users: unknown }>;
  };

  const teacher = Array.isArray(e.teacher) ? e.teacher[0] : e.teacher;
  const userRaw = teacher?.users;
  const u = (Array.isArray(userRaw) ? userRaw[0] : userRaw) as {
    full_name:           string | null;
    email:               string;
    language_preference: "es" | "de";
  } | undefined;
  if (!u?.email) return null;

  const monthYm = e.month.slice(0, 7);
  const invoice = await buildTeacherInvoicePdf({
    teacherId: e.teacher_id,
    month:     monthYm,
  });

  const lang = u.language_preference;
  const firstName = (u.full_name ?? "").trim().split(/\s+/)[0] || u.full_name || u.email;

  const amountFormatted = new Intl.NumberFormat(lang === "de" ? "de-DE" : "es-ES", {
    style:    "currency",
    currency: e.currency || "EUR",
  }).format(e.amount_cents / 100);

  const emailVars = {
    recipientName:    firstName,
    monthLabel:       invoice.monthLabel,
    amount:           amountFormatted,
    classesCount:     invoice.classesCount,
    totalHours:       invoice.totalHours,
    paymentReference,
    paymentMethod:    invoice.teacher.paymentMethod,
    language:         lang,
  };
  const pdfAttachment = {
    filename: invoice.filename,
    content:  invoice.pdfBuffer,
  };

  // 1. Profesor.
  const teacherEmailResult = await sendTeacherInvoicePaidEmail(
    u.email, emailVars, pdfAttachment,
  );
  if (!teacherEmailResult.ok) {
    console.error("[invoice-paid] email al profesor falló:", teacherEmailResult.error);
  }

  // 2. Copia a admin.
  const adminEmail = process.env.ADMIN_EMAIL?.trim();
  let adminResult: InvoicePaidSendResult["adminEmail"] = null;
  if (adminEmail && adminEmail !== u.email) {
    const r = await sendTeacherInvoicePaidEmail(
      adminEmail,
      {
        ...emailVars,
        audience:    "admin",
        teacherName: u.full_name ?? firstName,
      },
      pdfAttachment,
    );
    if (!r.ok) {
      console.error("[invoice-paid] email copia admin falló:", r.error);
    }
    adminResult = {
      to:    adminEmail,
      ok:    r.ok,
      error: r.ok ? undefined : r.error,
    };
  }

  return {
    teacherEmail: {
      to:    u.email,
      ok:    teacherEmailResult.ok,
      error: teacherEmailResult.ok ? undefined : teacherEmailResult.error,
    },
    adminEmail: adminResult,
  };
}
