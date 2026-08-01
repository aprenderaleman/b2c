import { supabaseAdmin } from "./supabase";

type RegisterOpts = {
  teacherId: string;
  studentId: string;
  amountCents: number;
  currency: string;
  stripePiId: string;
  stripeInvoiceId?: string | null;
  escenario?: string;
};

export async function registerCommission(opts: RegisterOpts): Promise<number> {
  const sb = supabaseAdmin();

  const { data: teacher } = await sb
    .from("teachers")
    .select("user_id")
    .eq("id", opts.teacherId)
    .maybeSingle();
  if (!teacher) {
    console.warn("[commission-engine] teacher not found:", opts.teacherId);
    return 0;
  }
  const teacherUserId = (teacher as { user_id: string }).user_id;

  const { data: userRow } = await sb
    .from("users")
    .select("rango")
    .eq("id", teacherUserId)
    .maybeSingle();
  const rango = (userRow as { rango: string | null } | null)?.rango ?? "starter";

  const { data: rangoRow } = await sb
    .from("config_rangos")
    .select("comision_pct")
    .eq("rol", "teacher")
    .eq("rango", rango)
    .maybeSingle();
  const pct = (rangoRow as { comision_pct: number } | null)?.comision_pct ?? 5;

  const commissionCents = Math.round(opts.amountCents * pct / 100);
  if (commissionCents <= 0) return 0;

  const mes = new Date().toISOString().slice(0, 7) + "-01";

  const { data: comision, error: insertErr } = await sb
    .from("comisiones")
    .insert({
      usuario_id: teacherUserId,
      tipo: "conversion",
      monto_cents: commissionCents,
      moneda: opts.currency,
      stripe_payment_intent_id: opts.stripePiId,
      stripe_invoice_id: opts.stripeInvoiceId ?? null,
      base_amount_cents: opts.amountCents,
      comision_pct: pct,
      escenario: opts.escenario ?? "E1",
      mes,
      pagado: false,
    })
    .select("id")
    .single();

  if (insertErr) {
    if (insertErr.code === "23505") {
      console.log("[commission-engine] idempotent skip:", opts.stripePiId, teacherUserId);
      return 0;
    }
    console.error("[commission-engine] insert failed:", insertErr);
    return 0;
  }

  const comisionId = (comision as { id: string }).id;

  await sb.from("class_hours_log").insert({
    teacher_id: opts.teacherId,
    duration_minutes: 0,
    rate_at_time: commissionCents,
    amount_cents: commissionCents,
    currency: opts.currency,
    kind: "commission",
    comision_id: comisionId,
  });

  const { error: rpcErr } = await sb.rpc("recompute_teacher_month", {
    p_teacher_id: opts.teacherId,
    p_any_date_in_month: new Date().toISOString(),
  });
  if (rpcErr) console.error("[commission-engine] recompute failed:", rpcErr);

  console.log(`[commission-engine] ${rango} ${pct}% on ${opts.amountCents}¢ = ${commissionCents}¢ for teacher ${opts.teacherId}`);
  return commissionCents;
}

export function isInCommissionWindow(commissionWindowEnd: string | null): boolean {
  if (!commissionWindowEnd) return false;
  return new Date(commissionWindowEnd) > new Date();
}
