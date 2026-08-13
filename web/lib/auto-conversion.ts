import { supabaseAdmin } from "./supabase";
import { convertLeadToStudent, type ConvertInput } from "./lead-conversion";
import { registerCommission, registerBonoCierre } from "./commission-engine";
import { calculateCommissions } from "./closer-commissions";
import { cancelActiveChain } from "./chain-engine";
import { runPostConversionFlow, detectScenario } from "./post-conversion-flow";
import { sendMetaPurchaseCapi } from "./meta-capi-server";
import { applyReferralReward } from "./referrals";

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
    .select("id, name, email, whatsapp_normalized, status, converted_to_user_id, meta, closer_id, fbclid")
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
    fbclid: string | null;
  };

  if (ld.converted_to_user_id) {
    // Caso real Nancy 2026-08-05: el closer confirmó el pago MANUALMENTE
    // antes de que llegara el webhook (entrega retrasada). La conversión
    // manual (convertLeadToStudent pelado) no rellena los campos Stripe,
    // ni el balance de clases, ni la oferta, ni comisiones. Completamos
    // aquí lo que falta en vez de solo marcar accepted_at y salir.
    console.log("[auto-conversion] lead already converted:", ld.id, "— completando datos");
    await sb.from("ofertas_enviadas")
      .update({ accepted_at: new Date().toISOString() })
      .eq("id", opts.ofertaId);

    const { data: existingStudent } = await sb
      .from("students")
      .select("id, oferta_id, stripe_customer_id")
      .eq("user_id", ld.converted_to_user_id)
      .maybeSingle();
    const es = existingStudent as { id: string; oferta_id: string | null; stripe_customer_id: string | null } | null;

    // Si ya tiene oferta ligada, el flujo automático ya corrió antes —
    // no tocar nada (idempotencia).
    if (!es || es.oferta_id) return;

    const lateClassesRemaining = of.tipo_pago === "suscripcion"
      ? (of.clases_por_mes ?? of.clases_totales)
      : of.clases_totales;
    const lateFields: Record<string, unknown> = {
      clases_totales:        of.clases_totales,
      clases_desbloqueadas:  lateClassesRemaining,
      oferta_id:             opts.ofertaId,
      // OJO: students_conversion_source_check solo permite
      // stripe_auto | manual | legacy — no inventar valores nuevos.
      conversion_source:     "stripe_auto",
      commission_window_end: new Date(Date.now() + 6 * 30 * 24 * 60 * 60 * 1000).toISOString(),
    };
    if (!es.stripe_customer_id && opts.stripeCustomerId) {
      lateFields.stripe_customer_id = opts.stripeCustomerId;
    }
    if (of.tipo_pago === "suscripcion") {
      lateFields.stripe_subscription_status = "active";
    }
    const { error: lateErr } = await sb.from("students").update(lateFields).eq("id", es.id);
    if (lateErr) {
      console.error("[auto-conversion] late student update failed:", lateErr.message);
    }

    await registerConversionExtras({
      sb, of, ld, opts,
      studentId: es.id,
      skipPostConversionFlow: true,   // el welcome ya salió con la conversión manual
    });
    try {
      await applyReferralReward(ld.id);
    } catch (err) {
      console.warn("[auto-conversion] applyReferralReward (late) failed:", err);
    }
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

  if (result.studentId) {
    await registerConversionExtras({
      sb, of, ld, opts,
      studentId: result.studentId,
      skipPostConversionFlow: false,
    });
  }

  // Recompensa de referido (si el lead vino con ?ref). DEBE ir después
  // del update de clases_desbloqueadas de arriba — la recompensa suma
  // encima del balance ya fijado. Idempotente en lib/referrals.
  try {
    await applyReferralReward(ld.id);
  } catch (err) {
    console.warn("[auto-conversion] applyReferralReward failed (non-fatal):", err);
  }

  console.log(`[auto-conversion] lead ${ld.id} → student ${result.studentId} via oferta ${opts.ofertaId}`);
}

type OfertaRow = {
  id: string; lead_id: string; teacher_id: string | null;
  closer_id: string | null;
  meta: string; ritmo: string | null; tipo_pago: string;
  clases_totales: number; clases_por_mes: number | null;
  importe_cents: number; accepted_at: string | null;
};

type LeadRow = {
  id: string; name: string | null; email: string | null;
  whatsapp_normalized: string | null; status: string;
  converted_to_user_id: string | null; meta: Record<string, unknown> | null;
  closer_id: string | null;
  fbclid: string | null;
};

/**
 * Comisiones + escenario + post-conversion + Meta CAPI + timeline.
 * Compartido por el camino normal (webhook convierte) y el tardío
 * (closer convirtió manualmente y el webhook llegó después).
 */
async function registerConversionExtras({
  sb, of, ld, opts, studentId, skipPostConversionFlow,
}: {
  sb: ReturnType<typeof supabaseAdmin>;
  of: OfertaRow;
  ld: LeadRow;
  opts: AutoConvertOpts;
  studentId: string;
  skipPostConversionFlow: boolean;
}): Promise<void> {
  if (opts.amountCents > 0) {
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
        studentId,
        stripePiId: opts.stripePiId,
        studentName: ld.name ?? "Estudiante",
      });

      await registerCommission({
        teacherId: trialTeacherId,
        studentId,
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

    if (!skipPostConversionFlow) {
      const ritmoLabel = of.ritmo ?? "";
      const packLabel = `${ritmoLabel} · ${of.clases_totales} clases`;
      await runPostConversionFlow({
        leadId: ld.id,
        studentId,
        leadName: ld.name ?? "Estudiante",
        closerId: effectiveCloserId,
        trialTeacherId: trialTeacherId ?? null,
        trialAttended,
        packLabel,
      }).catch(err => console.error("[auto-conversion] post-conversion failed:", err));
    }
  }

  try {
    await cancelActiveChain(ld.id, "converted_stripe_auto");
  } catch (err) {
    console.warn("[auto-conversion] cancelActiveChain failed:", err);
  }

  // ═══ Meta CAPI Purchase (server-side) ═══
  // Dispara Purchase con el valor REAL del pack (Gelfis 2026-07-28).
  // eventId = stripe payment_intent.id → dedup determinista.
  // Errores NO abortan la conversión — la venta real ya está registrada.
  const purchaseValueEur = opts.amountCents / 100;
  const eventIdPurchase = `sale_${opts.stripePiId}`;
  try {
    await sendMetaPurchaseCapi({
      eventId:  eventIdPurchase,
      value:    purchaseValueEur,
      currency: opts.currency || "EUR",
      email:    ld.email,
      phone:    ld.whatsapp_normalized,
      fbclid:   ld.fbclid,
    });
  } catch (err) {
    console.warn("[auto-conversion] Meta CAPI Purchase failed (non-fatal):", err);
  }

  // Timeline audit del disparo (útil para auditar atribución después).
  await sb.from("lead_timeline").insert({
    lead_id: ld.id,
    type:    "conversion",
    author:  "system",
    content: `💰 Compra confirmada — ${purchaseValueEur.toFixed(2)} ${opts.currency}. Meta CAPI Purchase disparado (event ${eventIdPurchase}).`,
    metadata: {
      kind:             "meta_capi_purchase_sent",
      value_cents:      opts.amountCents,
      currency:         opts.currency,
      event_id:         eventIdPurchase,
      stripe_pi_id:     opts.stripePiId,
      has_fbclid:       !!ld.fbclid,
    },
  }).then(() => {}, () => {});
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
