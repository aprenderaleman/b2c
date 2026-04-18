import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * POST /api/admin/finanzas/payments
 *
 * Admin records a payment (usually a bank transfer / Bizum / cash) and
 * optionally credits `classes_added` onto the student's classes_remaining
 * balance. Immediately status='paid' with paid_at=now() — we don't model
 * pending payments for the manual flow.
 */
const Body = z.object({
  studentId:     z.string().uuid(),
  amountEuros:   z.coerce.number().min(0).max(50000),
  currency:      z.enum(["EUR", "USD", "CHF"]).default("EUR"),
  type:          z.enum(["single_class", "package", "subscription_payment", "other"]),
  classesAdded:  z.coerce.number().int().min(0).max(500).default(0),
  note:          z.string().max(500).nullable().default(null),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed", details: parsed.error.flatten() }, { status: 400 });
  }

  const sb = supabaseAdmin();
  const amountCents = Math.round(parsed.data.amountEuros * 100);

  const { data: inserted, error: insErr } = await sb.from("payments").insert({
    student_id:    parsed.data.studentId,
    amount_cents:  amountCents,
    currency:      parsed.data.currency,
    type:          parsed.data.type,
    status:        "paid",
    classes_added: parsed.data.classesAdded,
    note:          parsed.data.note,
    paid_at:       new Date().toISOString(),
    created_by:    (session.user as { id?: string }).id ?? null,
  }).select("id").single();

  if (insErr || !inserted) {
    return NextResponse.json({ error: "insert_failed", message: insErr?.message }, { status: 500 });
  }

  // Top up the student's classes_remaining balance.
  if (parsed.data.classesAdded > 0) {
    const { data: student } = await sb
      .from("students")
      .select("classes_remaining")
      .eq("id", parsed.data.studentId)
      .maybeSingle();
    const current = Number((student as { classes_remaining?: number } | null)?.classes_remaining ?? 0);
    await sb
      .from("students")
      .update({ classes_remaining: current + parsed.data.classesAdded })
      .eq("id", parsed.data.studentId);
  }

  return NextResponse.json({ ok: true, paymentId: inserted.id });
}
