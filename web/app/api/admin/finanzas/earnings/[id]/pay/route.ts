import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * POST /api/admin/finanzas/earnings/[id]/pay
 *
 * Toggles a teacher_earnings row to paid=true (or back to paid=false if
 * the admin clicked "undo"). Also accepts an optional payment_reference
 * string for the bank transaction id / memo.
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

  const { id } = await params;
  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed", details: parsed.error.flatten() }, { status: 400 });
  }

  const sb = supabaseAdmin();
  const { error } = await sb
    .from("teacher_earnings")
    .update({
      paid:              parsed.data.paid,
      paid_at:           parsed.data.paid ? new Date().toISOString() : null,
      payment_reference: parsed.data.paymentReference ?? null,
    })
    .eq("id", id);
  if (error) {
    return NextResponse.json({ error: "update_failed", message: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
