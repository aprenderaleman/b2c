import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { buildTeacherInvoicePdf } from "@/lib/finance/teacher-invoice-pdf";
import { sendTeacherInvoicePaidEmail } from "@/lib/email/send";

// Needed by pdfkit's font loader (fs.readFileSync) — same reason every
// other PDF route is pinned to the Node runtime.
export const runtime = "nodejs";

/**
 * POST /api/admin/finanzas/earnings/[id]/pay
 *
 * Toggles a teacher_earnings row to paid=true (or back to paid=false if
 * the admin clicked "undo"). Also accepts an optional payment_reference
 * string for the bank transaction id / memo.
 *
 * Side effect (paid=true ONLY): emails the teacher a "te hemos pagado"
 * notice with the monthly invoice PDF attached. The send is best-
 * effort — the DB write returns first, the email runs after-response
 * via .catch(). A failed send won't roll back the paid flag.
 *
 * Note: NOT gated by LIFECYCLE_EMAILS_ENABLED — this is transactional
 * (teacher needs to know they got paid), not lifecycle noise.
 */
const Body = z.object({
  paid:             z.boolean(),
  paymentReference: z.string().max(200).nullable().optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const role = (session.user as { role?: string }).role;
  if (role !== "admin" && role !== "superadmin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await params;
  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed", details: parsed.error.flatten() }, { status: 400 });
  }
  const body = parsed.data;

  const sb = supabaseAdmin();
  const { error } = await sb
    .from("teacher_earnings")
    .update({
      paid:              body.paid,
      paid_at:           body.paid ? new Date().toISOString() : null,
      payment_reference: body.paymentReference ?? null,
    })
    .eq("id", id);
  if (error) {
    return NextResponse.json({ error: "update_failed", message: error.message }, { status: 500 });
  }

  // Fire the "te hemos pagado" email when flipping to paid. Failures
  // are logged but don't break the response — the admin's already
  // moved on to the next row.
  if (body.paid) {
    fireInvoicePaidEmail(id, body.paymentReference ?? null).catch(e => {
      console.error("[earnings/pay] invoice-paid email failed:", e);
    });
  }

  return NextResponse.json({ ok: true });
}

async function fireInvoicePaidEmail(
  earningsId:       string,
  paymentReference: string | null,
): Promise<void> {
  const sb = supabaseAdmin();

  // Pull the earnings row + the teacher's user info for routing.
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
  if (!earnings) return;

  const e = earnings as {
    teacher_id: string;
    month:      string;             // 'YYYY-MM-DD'
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
  if (!u?.email) return;

  // teacher_earnings.month is a DATE — Supabase returns "YYYY-MM-DD".
  // We need "YYYY-MM" for the PDF builder.
  const monthYm = e.month.slice(0, 7);

  // Build the PDF in-memory and attach it.
  const invoice = await buildTeacherInvoicePdf({
    teacherId: e.teacher_id,
    month:     monthYm,
  });

  const lang = u.language_preference;
  const firstName = (u.full_name ?? "").trim().split(/\s+/)[0] || u.full_name || u.email;

  // Format the monetary amount in the language's locale. We trust
  // the row's currency (defaults to EUR).
  const amountFormatted = new Intl.NumberFormat(lang === "de" ? "de-DE" : "es-ES", {
    style:    "currency",
    currency: e.currency || "EUR",
  }).format(e.amount_cents / 100);

  await sendTeacherInvoicePaidEmail(
    u.email,
    {
      recipientName:    firstName,
      monthLabel:       invoice.monthLabel,
      amount:           amountFormatted,
      classesCount:     invoice.classesCount,
      totalHours:       invoice.totalHours,
      paymentReference,
      paymentMethod:    invoice.teacher.paymentMethod,
      language:         lang,
    },
    {
      filename: invoice.filename,
      content:  invoice.pdfBuffer,
    },
  );
}
