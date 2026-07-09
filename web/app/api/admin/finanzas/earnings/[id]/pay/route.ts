import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { sendInvoicePaidEmails } from "@/lib/finance/send-invoice-paid";

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
    sendInvoicePaidEmails(id, body.paymentReference ?? null).catch(e => {
      console.error("[earnings/pay] invoice-paid email failed:", e);
    });
  }

  return NextResponse.json({ ok: true });
}

