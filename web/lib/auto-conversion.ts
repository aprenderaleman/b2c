import { supabaseAdmin } from "./supabase";
import { convertLeadToStudent, type ConvertInput } from "./lead-conversion";
import { registerCommission, registerBonoCierre } from "./commission-engine";
import { calculateCommissions } from "./closer-commissions";
import { cancelActiveChain } from "./chain-engine";
import { runPostConversionFlow, detectScenario } from "./post-conversion-flow";
import { sendMetaPurchaseCapi } from "./meta-capi-server";

type AutoConvertOpts = {
  leadId: string;
  ofertaId: string;
  stripeCustomerId: string;
  stripePiId: string;
  stripeInvoiceId?: string | null;
  amountCents: number;
  currency: string;
  account: "us" | "de";
};

export async function handleFirstPayment(opts: AutoConvertOpts): Promise<void> {
  const sb = supabaseAdmin();

  const { data: oferta } = await sb
    .from("ofertas_enviadas")
    .select("*")
    .eq("id", opts.ofertaId)
    .maybeSingle();

  if (!oferta) {
    console.error("[auto-conversion] oferta not found:", opts.ofertaId);
    return;
  }

  const of = oferta as {
    id: string; lead_id: string; teacher_id: string | null;
    closer_id: string | null;
    meta: string; ritmo: string | null; tipo_pago: string;
    clases_totales: number; clases_por_mes: number | null;
    importe_cents: number; accepted_at: string | null;
  };

  if (of.accepted_at) {
    console.log("[auto-conversion] oferta already accepted:", opts.ofertaId);
    return;
  }

  const { data: lead } = await sb
    .from("leads")
    .select("id, name, email, whatsapp_normalized, status, converted_to_user_id, meta, closer_id")
    .eq("id", of.lead_id)
    .maybeSingle();

  if (!lead) {
    console.error("[auto-conversion] lead not found:", of.lead_id);
    return;
  }

  const ld = lead as {
    id: string; name: string | null; email: string | null;
    whatsapp_normalized: string | null; status: string;
    converted_to_user_id: string | null; meta: Record<string, unknown> | null;
    closer_id: string | null;
  };

  if (ld.converted_to_user_id) {
    console.log("[auto-conversion] lead already converted:", ld.id);
    await sb.from("ofertas_enviadas")
      .update({ accepted_at: new Date().toISOString() })
      .eq("id", opts.ofertaId);
    return;
  }

  const subscriptionType = of.tipo_pago === "suscripcion" ? "monthly_subscription" : "package";
  const classesRemaining = of.tipo_pago === "suscripcion"
    ? (of.clases_por_mes ?? of.clases_totales)
    : of.clases_totales;

  const levelFromMeta = (ld.meta as Record<string, unknown> | null)?.nivel as string | undefined;

  const convertInput: ConvertInput = {
    email: ld.email ?? `lead-${ld.id}@placeholder.local`,
    fullName: ld.name ?? "Estudiante",
    phone: ld.whatsapp_normalized,
    language: "es",
    currentLevel: (levelFromMeta as ConvertInput["currentLevel"]) ?? "A1",
    goal: of.meta,
    subscriptionType,
    classesRemaining,
    classesPerMonth: of.clases_por_mes,
    monthlyPriceEuros: of.tipo_pago === "suscripcion" && of.clases_por_mes
      ? Math.round(of.importe_cents / ((of.clases_totales / of.clases_por_mes) * 100)) / 1
      : null,
    currency: "EUR",
    horarios: null,
  };

  const result = await convertLeadToStudent(ld.id, convertInput, {
    skipLegacyCommission: true,
    stripeCustomerId: opts.stripeCustomerId,
    ofertaId: opts.ofertaId,
    conversionSource: "stripe_auto",
  });

  if (!result.ok) {
    console.error("[auto-conversion] convertLeadToStudent failed for lead:", ld.id);
    return;
  }

  if (result.studentId) {
    const commissionWindowEnd = new Date(Date.now() + 6 * 30 * 24 * 60 * 60 * 1000).toISOString();

    const updateFields: Record<string, unknown> = {
      clases_totales: of.clases_totales,
      clases_desbloqueadas: classesRemaining,
      oferta_id: opts.ofertaId,
      conversion_source: "stripe_auto",
      commission_window_end: commissionWindowEnd,
      stripe_customer_id: opts.stripeCustomerId,
    };
    if (of.tipo_pago === "suscripcion") {
      updateFields.stripe_subscription_status = "active";
    }

    await sb.from("students").update(updateFields).eq("id", result.studentId);
  }

  await sb.from("ofertas_enviadas")
    .update({ accepted_at: new Date().toISOString() })
    .eq("id", opts.ofertaId);

  if (result.studentId && opts.amountCents > 0) {
    const closerId = of.closer_id ?? ld.closer_id;
    const { data: trialClass } = await sb
      .from("classes")
      .select("teacher_id, status")
      .eq("lead_id", ld.id)
      .eq("is_trial", true)
      .in("status", ["completed", "scheduled", "live"])
      .order("scheduled_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const trialTeacherId = (trialClass as { teacher_id?: string } | null)?.teacher_id ?? of.teacher_id;
    const trialAttended = (trialClass as { status?: string } | null)?.status === "completed";

    const attributed = closerId
      ? await isCloserAttribution(ld.id, closerId)
      : false;
    const effectiveCloserId = attributed ? closerId : null;
    const scenario = detectScenario({ closerId: effectiveCloserId, trialAttended });

    if (scenario === "E1" && trialTeacherId) {
      await registerBonoCierre({
        teacherId: trialTeacherId,
        studentId: result.studentId,
        stripePiId: opts.stripePiId,
        studentName: ld.name ?? "Estudiante",
      });

      await registerCommission({
        teacherId: trialTeacherId,
        studentId: result.studentId,
        amountCents: opts.amountCents,
        currency: opts.currency,
        stripePiId: opts.stripePiId,
        stripeInvoiceId: opts.stripeInvoiceId,
        escenario: "E1",
      });
    } else if (scenario === "E2" || scenario === "E3") {
      const { data: ventaRecord } = await sb.from("ventas").insert({
        lead_id: ld.id,
        solicitado_por: effectiveCloserId!,
        rol_solicitante: "closer",
        pack_id: of.ritmo ?? null,
        payment_type: of.tipo_pago,
        monto_cents: opts.amountCents,
        moneda: opts.currency,
        estado: "aprobada",
        aprobado_por: effectiveCloserId!,
        aprobado_at: new Date().toISOString(),
      }).select("id").single();

      if (ventaRecord) {
        const ventaId = (ventaRecord as { id: string }).id;
        try {
          await calculateCommissions(ventaId, { stripePiId: opts.stripePiId });
        } catch (err) {
          console.error("[auto-conversion] calculateCommissions failed:", err);
        }
      }
    }

    await sb.from("ofertas_enviadas")
      .update({ escenario: scenario })
      .eq("id", opts.ofertaId);

    const ritmoLabel = of.ritmo ?? "";
    const packLabel = `${ritmoLabel} · ${of.clases_totales} clases`;
    await runPostConversionFlow({
      leadId: ld.id,
      studentId: result.studentId,
      leadName: ld.name ?? "Estudiante",
      closerId: effectiveCloserId,
      trialTeacherId: trialTeacherId ?? null,
      trialAttended,
      packLabel,
    }).catch(err => console.error("[auto-conversion] post-conversion failed:", err));
  }

  try {
    await cancelActiveChain(ld.id, "converted_stripe_auto");
  } catch (err) {
    console.warn("[auto-conversion] cancelActiveChain failed:", err);
  }

  console.log(`[auto-conversion] lead ${ld.id} → student ${result.studentId} via oferta ${opts.ofertaId}`);
}

async function isCloserAttribution(leadId: string, closerId: string): Promise<boolean> {
  const sb = supabaseAdmin();

  const { data: activeChain } = await sb
    .from("lead_chains")
    .select("id")
    .eq("lead_id", leadId)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  if (activeChain) return true;

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3_600_000).toISOString();
  const { data: recentAction } = await sb
    .from("acciones_closer")
    .select("id")
    .eq("closer_id", closerId)
    .eq("lead_id", leadId)
    .gte("created_at", thirtyDaysAgo)
    .limit(1)
    .maybeSingle();

  return Boolean(recentAction);
}
