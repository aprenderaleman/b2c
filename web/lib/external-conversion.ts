import { supabaseAdmin } from "./supabase";
import { convertLeadToStudent, type ConvertInput } from "./lead-conversion";
import { cancelActiveChain } from "./chain-engine";

const GOAL_MAP: Record<string, string> = {
  a1a2: "a1_a2",
  a1_a2: "a1_a2",
  b1: "b1",
  b2: "b2",
  c1: "c1",
  zero_to_b1: "fluidez_total",
  fluidez_total: "fluidez_total",
  fluidez: "fluidez_total",
};

function normalizeGoal(raw: string | null): string | null {
  if (!raw) return null;
  return GOAL_MAP[raw.toLowerCase()] ?? raw;
}

type ExternalConversionOpts = {
  leadId: string;
  checkoutSessionId: string;
  subscriptionId: string | null;
  customerId: string;
  paymentIntentId: string | null;
  mode: "subscription" | "payment";
  goalId: string | null;
  rhythmId: string | null;
  maxInvoices: number | null;
  totalClasses: number;
  classesPerMonth: number;
  amountCents: number;
  currency: string;
  customerEmail: string | null;
  customerName: string | null;
  customerPhone: string | null;
  customerCountry: string | null;
  source: string;
};

export async function handleExternalConversion(opts: ExternalConversionOpts): Promise<void> {
  const sb = supabaseAdmin();

  const { data: lead } = await sb
    .from("leads")
    .select("id, name, email, whatsapp_normalized, status, converted_to_user_id, meta, closer_id, fbclid")
    .eq("id", opts.leadId)
    .maybeSingle();

  if (!lead) {
    console.error("[external-conversion] lead not found:", opts.leadId);
    throw new Error("lead_not_found");
  }

  const ld = lead as {
    id: string; name: string | null; email: string | null;
    whatsapp_normalized: string | null; status: string;
    converted_to_user_id: string | null;
    meta: Record<string, unknown> | null;
    closer_id: string | null; fbclid: string | null;
  };

  if (ld.converted_to_user_id) {
    console.log("[external-conversion] lead already converted:", ld.id);
    return;
  }

  const goal = normalizeGoal(opts.goalId);
  const subscriptionType = opts.mode === "subscription" ? "monthly_subscription" : "package";
  const classesRemaining = opts.mode === "subscription"
    ? (opts.classesPerMonth || opts.totalClasses)
    : opts.totalClasses;

  const levelFromMeta = (ld.meta as Record<string, unknown> | null)?.nivel as string | undefined;

  const email = opts.customerEmail ?? ld.email ?? `lead-${ld.id}@placeholder.local`;
  const fullName = opts.customerName ?? ld.name ?? "Estudiante";
  const phone = opts.customerPhone ?? ld.whatsapp_normalized;

  const convertInput: ConvertInput = {
    email,
    fullName,
    phone,
    language: "es",
    currentLevel: (levelFromMeta as ConvertInput["currentLevel"]) ?? "A1",
    goal,
    subscriptionType,
    classesRemaining,
    classesPerMonth: opts.classesPerMonth || null,
    monthlyPriceEuros: opts.mode === "subscription" && opts.classesPerMonth
      ? opts.amountCents / 100
      : null,
    currency: (opts.currency as "EUR" | "USD" | "CHF") || "EUR",
    horarios: null,
  };

  const result = await convertLeadToStudent(ld.id, convertInput, {
    skipLegacyCommission: true,
    stripeCustomerId: opts.customerId || undefined,
    conversionSource: `external_${opts.source}`,
  });

  if (!result.ok || !result.studentId) {
    console.error("[external-conversion] convertLeadToStudent failed for lead:", ld.id);
    return;
  }

  // Oferta primero: el desbloqueo mensual de handleInvoicePaid lee
  // clases_por_mes vía students.oferta_id → sin el vínculo, las
  // renovaciones de suscriptores externos NO desbloquearían clases.
  const { data: ofertaRow, error: ofertaErr } = await sb.from("ofertas_enviadas").insert({
    lead_id: ld.id,
    meta: goal ?? "desconocido",
    ritmo: opts.rhythmId,
    tipo_pago: opts.mode === "subscription" ? "suscripcion" : "unico",
    clases_totales: opts.totalClasses,
    clases_por_mes: opts.classesPerMonth || null,
    importe_cents: opts.amountCents,
    moneda: opts.currency,
    accepted_at: new Date().toISOString(),
    escenario: "E1",
  }).select("id").single();
  if (ofertaErr) console.error("[external-conversion] oferta insert failed:", ofertaErr.message);
  const ofertaId = (ofertaRow as { id: string } | null)?.id ?? null;

  const updateFields: Record<string, unknown> = {
    clases_totales: opts.totalClasses,
    clases_desbloqueadas: classesRemaining,
    // OJO: students_conversion_source_check solo permite
    // stripe_auto | manual | legacy. El origen externo queda en el
    // timeline (metadata.source) — aquí el valor válido más cercano.
    conversion_source: "stripe_auto",
    stripe_customer_id: opts.customerId || undefined,
    ...(ofertaId ? { oferta_id: ofertaId } : {}),
  };
  if (opts.subscriptionId) {
    updateFields.stripe_subscription_id = opts.subscriptionId;
    updateFields.stripe_subscription_status = "active";
  }

  const { error: updErr } = await sb.from("students").update(updateFields).eq("id", result.studentId);
  if (updErr) console.error("[external-conversion] student update failed:", updErr.message);

  await sb.from("lead_timeline").insert({
    lead_id: ld.id,
    type: "conversion",
    author: "system",
    content: `🌐 Conversión externa (${opts.source}) — ${(opts.amountCents / 100).toFixed(2)} ${opts.currency}. ` +
      `Goal: ${goal ?? "?"}, Ritmo: ${opts.rhythmId ?? "único"}. ` +
      `Stripe: ${opts.checkoutSessionId}`,
    metadata: {
      kind: "external_conversion",
      source: opts.source,
      stripe_session_id: opts.checkoutSessionId,
      stripe_subscription_id: opts.subscriptionId,
      stripe_customer_id: opts.customerId,
      goal_id: goal,
      rhythm_id: opts.rhythmId,
      amount_cents: opts.amountCents,
      currency: opts.currency,
    },
  });

  // NO disparamos Meta CAPI Purchase — el webhook de aprender-aleman.de
  // ya lo hizo con el mismo pixel. Evitamos doble-count.

  try {
    await cancelActiveChain(ld.id, `converted_external_${opts.source}`);
  } catch (err) {
    console.warn("[external-conversion] cancelActiveChain failed:", err);
  }

  console.log(`[external-conversion] lead ${ld.id} → student ${result.studentId} via ${opts.source}`);
}
