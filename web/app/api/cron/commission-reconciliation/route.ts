import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { sendRaw } from "@/lib/email/send";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ADMIN_EMAIL = process.env.ADMIN_ALERT_EMAIL ?? "aprenderaleman2026@gmail.com";

export async function GET() {
  try {
    return await reconcile();
  } catch (err) {
    const e = err as Error;
    console.error("[commission-reconciliation] UNHANDLED:", e.message);
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

export const POST = GET;

async function reconcile() {
  const sb = supabaseAdmin();
  const now = new Date();
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 1);
  const mesStr = prevMonthStart.toISOString().slice(0, 10);

  const discrepancies: string[] = [];

  // 1. Check payments from previous month that lack commission entries
  const { data: payments } = await sb
    .from("payments")
    .select("id, student_id, amount_cents, stripe_payment_intent_id, type")
    .gte("paid_at", prevMonthStart.toISOString())
    .lt("paid_at", prevMonthEnd.toISOString())
    .eq("status", "paid")
    .in("type", ["subscription_payment", "package"]);

  let missingCommissions = 0;
  for (const p of (payments ?? []) as Array<{
    id: string; student_id: string; amount_cents: number;
    stripe_payment_intent_id: string | null; type: string;
  }>) {
    if (!p.stripe_payment_intent_id) continue;

    const { data: student } = await sb
      .from("students")
      .select("id, trial_teacher_id, commission_window_end, oferta_id")
      .eq("id", p.student_id)
      .maybeSingle();
    const s = student as {
      id: string; trial_teacher_id: string | null;
      commission_window_end: string | null; oferta_id: string | null;
    } | null;

    if (!s?.trial_teacher_id || !s.oferta_id) continue;
    if (!s.commission_window_end || new Date(s.commission_window_end) < prevMonthStart) continue;

    const { data: existing } = await sb
      .from("comisiones")
      .select("id")
      .eq("stripe_payment_intent_id", p.stripe_payment_intent_id)
      .eq("usuario_id", (await sb.from("teachers").select("user_id").eq("id", s.trial_teacher_id).maybeSingle()).data?.user_id ?? "")
      .maybeSingle();

    if (!existing) {
      missingCommissions++;
      discrepancies.push(`Payment ${p.id} (${p.amount_cents}¢) has no commission for teacher ${s.trial_teacher_id}`);
    }
  }

  // 2. Recompute teacher_month for all active teachers
  const { data: teachers } = await sb
    .from("teachers")
    .select("id")
    .eq("active", true);

  let recomputed = 0;
  for (const t of (teachers ?? []) as Array<{ id: string }>) {
    const { error } = await sb.rpc("recompute_teacher_month", {
      p_teacher_id: t.id,
      p_any_date_in_month: prevMonthStart.toISOString(),
    });
    if (error) {
      discrepancies.push(`recompute_teacher_month failed for ${t.id}: ${error.message}`);
    } else {
      recomputed++;
    }
  }

  // 3. Send admin email if discrepancies found
  if (discrepancies.length > 0) {
    const html = `
      <h3>Reconciliacion de comisiones — ${mesStr}</h3>
      <p><strong>${missingCommissions}</strong> pagos sin comision registrada.</p>
      <p><strong>${recomputed}</strong> profes recomputados.</p>
      <h4>Discrepancias:</h4>
      <ul>${discrepancies.map(d => `<li>${d}</li>`).join("")}</ul>
    `;
    await sendRaw(ADMIN_EMAIL, `⚠️ Reconciliación comisiones ${mesStr}`, html, discrepancies.join("\n"));
  }

  return NextResponse.json({
    ok: true,
    mes: mesStr,
    payments_checked: payments?.length ?? 0,
    missing_commissions: missingCommissions,
    teachers_recomputed: recomputed,
    discrepancies: discrepancies.length,
  });
}
