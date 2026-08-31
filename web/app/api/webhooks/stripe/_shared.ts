import type Stripe from "stripe";
import { supabaseAdmin } from "@/lib/supabase";
import { getStripeClient } from "@/lib/stripe";
import { getExchangeRate, convertToEur } from "@/lib/exchange-rates";
import { cancelActiveChain } from "@/lib/chain-engine";
import { sendRaw } from "@/lib/email/send";
import { handleFirstPayment } from "@/lib/auto-conversion";
import { registerCommission, isInCommissionWindow } from "@/lib/commission-engine";

export async function processStripeEvent(
  event: Stripe.Event,
  account: "us" | "de",
): Promise<void> {
  const sb = supabaseAdmin();

  // Idempotency: skip if already processed
  const { data: existing } = await sb
    .from("stripe_events")
    .select("event_id")
    .eq("event_id", event.id)
    .maybeSingle();
  if (existing) return;

  // Mark as processed immediately to prevent races
  await sb.from("stripe_events").insert({
    event_id: event.id,
    event_type: event.type,
    account_tag: account,
  });

  if (event.type === "checkout.session.completed") {
    await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session, account);
  } else if (event.type === "payment_intent.succeeded") {
    await handlePaymentIntentSucceeded(event.data.object as Stripe.PaymentIntent, account);
  } else if (event.type === "invoice.paid" || event.type === "invoice.payment_succeeded") {
    await handleInvoicePaid(event.data.object as Stripe.Invoice, account);
  } else if (
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted"
  ) {
    await handleSubscriptionChange(event.data.object as Stripe.Subscription);
  }
}

async function handleCheckoutCompleted(
  session: Stripe.Checkout.Session,
  account: "us" | "de",
): Promise<void> {
  const sb = supabaseAdmin();

  const amountTotal = session.amount_total ?? 0;
  const currency = (session.currency ?? "eur").toUpperCase();
  const customerEmail = session.customer_details?.email ?? session.customer_email;
  const paymentIntentId = typeof session.payment_intent === "string"
    ? session.payment_intent
    : (session.payment_intent as Stripe.PaymentIntent | null)?.id ?? null;

  // === Rama Reserva Prioritaria (2026-07-24) — depósito 10€ sobre un
  // LEAD (no student todavía). Marcamos flag + timeline y salimos antes
  // de tocar `payments` (esa tabla exige student_id). Los 10€ se
  // contabilizarán cuando el lead convierta a pack.
  if (session.metadata?.type === "trial_deposit" || session.metadata?.type === "trial_deposit_metaads") {
    const leadId  = session.metadata.lead_id;
    const classId = session.metadata.class_id;
    if (!leadId) {
      console.warn("[stripe-webhook] trial_deposit sin lead_id en metadata", session.id);
      return;
    }
    await sb.from("leads").update({
      reserva_prioritaria:              true,
      reserva_prioritaria_paid_at:      new Date().toISOString(),
      reserva_prioritaria_amount_cents: amountTotal || 1000,
    }).eq("id", leadId);
    await sb.from("lead_timeline").insert({
      lead_id: leadId,
      type:    "status_change",
      author:  "gelfis",
      content: `💳 Reserva Prioritaria pagada — ${(amountTotal / 100).toFixed(2)}${currency} (session ${session.id}, class ${classId ?? "?"})`,
      metadata: {
        kind:                "priority_reserve_paid",
        stripe_session_id:   session.id,
        stripe_payment_intent_id: paymentIntentId,
        amount_cents:        amountTotal,
        currency,
        account,
      },
    });
    return;
  }

  // === Enrollment checkout — first payment triggers auto-conversion
  if (session.metadata?.type === "enrollment") {
    const ofertaId = session.metadata.oferta_id;
    const leadId = session.metadata.lead_id;
    if (!ofertaId || !leadId) {
      console.warn("[stripe-webhook] enrollment sin oferta_id/lead_id", session.id);
      return;
    }

    // Registro legal (FASE 2, §10.2): volcar el consentimiento del
    // checkbox de TyC de Stripe a terms_acceptances. El custom_text
    // mostrado incluía la solicitud de inicio inmediato, así que
    // consent aceptado = TyC + §10.2 probados con timestamp e IP.
    try {
      const tos = session.consent?.terms_of_service ?? null;
      // Si Stripe no devolvió consent (p.ej. la session se creó con el
      // fallback sin checkbox), solo sellamos accepted_at — sin
      // sobreescribir el marcador 'not_shown'.
      const patch: Record<string, unknown> = { accepted_at: new Date().toISOString() };
      if (tos) {
        patch.tos_consent             = tos;
        patch.immediate_start_consent = tos === "accepted";
      }
      await sb.from("terms_acceptances").update(patch).eq("stripe_session_id", session.id);
    } catch (e) {
      console.error("[stripe-webhook] terms_acceptances update failed:", e);
    }
    const stripeCustomerId = typeof session.customer === "string"
      ? session.customer
      : (session.customer as { id: string } | null)?.id ?? "";
    try {
      await handleFirstPayment({
        leadId,
        ofertaId,
        stripeCustomerId,
        stripePiId: paymentIntentId ?? session.id,
        amountCents: amountTotal,
        currency,
        account,
      });
    } catch (err) {
      console.error("[stripe-webhook] handleFirstPayment failed:", err);
    }
    return;
  }

  if (!customerEmail && !session.customer) return;
  if (amountTotal === 0) return;

  // Check if payment already exists (by payment_intent_id)
  if (paymentIntentId) {
    const { data: dup } = await sb
      .from("payments")
      .select("id")
      .eq("stripe_payment_intent_id", paymentIntentId)
      .maybeSingle();
    if (dup) return;
  }

  const stripeCustomerId = typeof session.customer === "string"
    ? session.customer
    : (session.customer as { id: string } | null)?.id ?? null;

  const student = await resolveStudent(sb, {
    stripeCustomerId,
    metadata: (session.metadata ?? {}) as Record<string, string>,
    email: customerEmail,
  }, account, `checkout.session.completed ${session.id} · ${amountTotal}¢ ${currency}`);

  if (!student) return;

  const rate = await getExchangeRate(currency, "EUR");
  const eurCents = convertToEur(amountTotal, currency, rate);

  await sb.from("payments").insert({
    student_id: (student as { id: string }).id,
    amount_cents: eurCents,
    currency: "EUR",
    type: inferPaymentType(session),
    status: "paid",
    paid_at: new Date().toISOString(),
    stripe_payment_intent_id: paymentIntentId,
    stripe_account: account,
    original_currency: currency,
    original_amount_cents: amountTotal,
    exchange_rate: rate,
    stripe_charge_id: null,
    note: `Stripe ${account.toUpperCase()} checkout`,
  });

  if (customerEmail) await cutChainByEmail(sb, customerEmail);
}

async function handlePaymentIntentSucceeded(
  pi: Stripe.PaymentIntent,
  account: "us" | "de",
): Promise<void> {
  const sb = supabaseAdmin();

  // Reserva Prioritaria (fallback si checkout.session.completed no llegó
  // primero). Idempotencia vía leads.reserva_prioritaria (ya se marcó).
  if (pi.metadata?.type === "trial_deposit" || pi.metadata?.type === "trial_deposit_metaads") {
    const leadId = pi.metadata.lead_id;
    if (!leadId) return;
    const { data: alreadyPaid } = await sb
      .from("leads")
      .select("reserva_prioritaria")
      .eq("id", leadId)
      .maybeSingle();
    if ((alreadyPaid as { reserva_prioritaria?: boolean } | null)?.reserva_prioritaria) return;
    await sb.from("leads").update({
      reserva_prioritaria:              true,
      reserva_prioritaria_paid_at:      new Date().toISOString(),
      reserva_prioritaria_amount_cents: pi.amount || 1000,
    }).eq("id", leadId);
    await sb.from("lead_timeline").insert({
      lead_id: leadId,
      type:    "status_change",
      author:  "gelfis",
      content: `💳 Reserva Prioritaria pagada (payment_intent fallback) — ${(pi.amount / 100).toFixed(2)}${(pi.currency ?? "eur").toUpperCase()} (pi ${pi.id})`,
      metadata: {
        kind:                     "priority_reserve_paid",
        stripe_payment_intent_id: pi.id,
        amount_cents:             pi.amount,
        currency:                 (pi.currency ?? "eur").toUpperCase(),
        account,
      },
    });
    return;
  }

  // Si el PI pertenece a un invoice (cobro de suscripción), lo maneja
  // handleInvoicePaid — evita la fila duplicada tipo "other" (caso
  // Nancy 2026-08-05). En API nuevas el campo puede no venir; el
  // dedup heurístico del invoice handler cubre ese hueco.
  const piInvoice = (pi as unknown as { invoice?: string | { id: string } | null }).invoice;
  if (piInvoice) return;

  // Skip if already handled via checkout.session.completed
  const { data: dup } = await sb
    .from("payments")
    .select("id")
    .eq("stripe_payment_intent_id", pi.id)
    .maybeSingle();
  if (dup) return;

  const currency = (pi.currency ?? "eur").toUpperCase();
  let customerEmail = typeof pi.receipt_email === "string" ? pi.receipt_email : null;

  // Resolve email from Stripe customer if receipt_email is null
  if (!customerEmail && pi.customer) {
    try {
      const customerId = typeof pi.customer === "string" ? pi.customer : pi.customer.id;
      const customer = await getStripeClient(account).customers.retrieve(customerId);
      if (!customer.deleted && customer.email) {
        customerEmail = customer.email;
      }
    } catch { /* ignore */ }
  }

  if (pi.amount === 0) return;
  if (!customerEmail && !pi.customer) return;

  const stripeCustomerId = typeof pi.customer === "string"
    ? pi.customer
    : (pi.customer as { id: string } | null)?.id ?? null;

  const student = await resolveStudent(sb, {
    stripeCustomerId,
    metadata: (pi.metadata ?? {}) as Record<string, string>,
    email: customerEmail,
  }, account, `payment_intent.succeeded ${pi.id} · ${pi.amount}¢ ${(pi.currency ?? "eur").toUpperCase()}`);

  if (!student) return;

  const rate = await getExchangeRate(currency, "EUR");
  const eurCents = convertToEur(pi.amount, currency, rate);

  const latestCharge = pi.latest_charge;
  const chargeId = typeof latestCharge === "string"
    ? latestCharge
    : (latestCharge as Stripe.Charge | null)?.id ?? null;

  await sb.from("payments").insert({
    student_id: (student as { id: string }).id,
    amount_cents: eurCents,
    currency: "EUR",
    type: "other",
    status: "paid",
    paid_at: new Date(pi.created * 1000).toISOString(),
    stripe_payment_intent_id: pi.id,
    stripe_account: account,
    original_currency: currency,
    original_amount_cents: pi.amount,
    exchange_rate: rate,
    stripe_charge_id: chargeId,
    note: `Stripe ${account.toUpperCase()} payment_intent`,
  });

  if (customerEmail) await cutChainByEmail(sb, customerEmail);
}

async function handleInvoicePaid(
  invoice: Stripe.Invoice,
  account: "us" | "de",
): Promise<void> {
  const sb = supabaseAdmin();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const inv = invoice as any;
  const piRaw = inv.payment_intent;
  const piId: string | null = typeof piRaw === "string"
    ? piRaw
    : piRaw?.id ?? null;

  // Dedup 1: por invoice id — invoice.paid e invoice.payment_succeeded
  // llegan AMBOS para el mismo cobro (caso Nancy 2026-08-05: 320€
  // insertados 3 veces). El índice único de migración 105 es la última
  // línea de defensa; este check evita el error de insert.
  if (invoice.id) {
    const { data: dupInv } = await sb
      .from("payments")
      .select("id")
      .eq("stripe_invoice_id", invoice.id)
      .maybeSingle();
    if (dupInv) return;
  }

  // Dedup 2: por payment_intent (si el API aún lo incluye — las
  // versiones nuevas de Stripe ya no lo mandan en el invoice).
  if (piId) {
    const { data: dup } = await sb
      .from("payments")
      .select("id")
      .eq("stripe_payment_intent_id", piId)
      .maybeSingle();
    if (dup) return;
  }

  const amountPaid = invoice.amount_paid ?? 0;
  if (amountPaid === 0) return;

  const currency = (invoice.currency ?? "eur").toUpperCase();
  const customerEmail = invoice.customer_email;

  const invoiceCustomer = typeof invoice.customer === "string"
    ? invoice.customer
    : (invoice.customer as { id: string } | null)?.id ?? null;

  const student = await resolveStudent(sb, {
    stripeCustomerId: invoiceCustomer,
    metadata: (invoice.metadata ?? {}) as Record<string, string>,
    email: customerEmail,
  }, account, `invoice.paid ${invoice.id} · ${amountPaid}¢ ${currency}`);

  if (!student) return;

  const rate = await getExchangeRate(currency, "EUR");
  const eurCents = convertToEur(amountPaid, currency, rate);

  const isSubscription = invoice.lines?.data?.some(
    (line) => (line as unknown as { type?: string }).type === "subscription" || line.description?.includes("×"),
  );

  // Dedup 3 (heurístico): el payment_intent.succeeded del mismo cobro
  // pudo insertar ya una fila (sin invoice id y, en API nuevas, sin
  // forma de cruzarlos). Mismo student + mismo importe original a ±1h
  // del paid_at del invoice = mismo cobro. Los renewals legítimos van
  // con ~1 mes de separación, así que la ventana es segura. Se ancla
  // al paid_at del INVOICE (no a "ahora") para que también funcione
  // cuando el evento llega tarde vía el cron stripe-reconcile.
  const invoicePaidMs = invoice.status_transitions?.paid_at
    ? invoice.status_transitions.paid_at * 1000
    : Date.now();
  const { data: recentSameAmount } = await sb
    .from("payments")
    .select("id")
    .eq("student_id", (student as { id: string }).id)
    .eq("original_amount_cents", amountPaid)
    .gte("paid_at", new Date(invoicePaidMs - 3600_000).toISOString())
    .lte("paid_at", new Date(invoicePaidMs + 3600_000).toISOString())
    .limit(1)
    .maybeSingle();
  if (recentSameAmount) {
    // Ya hay fila del PI — solo estampamos el invoice id para que el
    // dedup 1 corte el segundo evento invoice.* de este cobro.
    await sb.from("payments")
      .update({ stripe_invoice_id: invoice.id ?? null, type: isSubscription ? "subscription_payment" : "package" })
      .eq("id", (recentSameAmount as { id: string }).id);
  } else {
    await sb.from("payments").insert({
      student_id: (student as { id: string }).id,
      amount_cents: eurCents,
      currency: "EUR",
      type: isSubscription ? "subscription_payment" : "package",
      status: "paid",
      paid_at: invoice.status_transitions?.paid_at
        ? new Date(invoice.status_transitions.paid_at * 1000).toISOString()
        : new Date().toISOString(),
      stripe_payment_intent_id: piId,
      stripe_invoice_id: invoice.id ?? null,
      stripe_account: account,
      original_currency: currency,
      original_amount_cents: amountPaid,
      exchange_rate: rate,
      stripe_charge_id: null,
    });
  }

  // Subscription renewal: unlock classes + register commission if in window
  if (isSubscription) {
    const { data: studentData } = await sb
      .from("students")
      .select("id, oferta_id, trial_teacher_id, commission_window_end, classes_per_month, clases_por_mes:ofertas_enviadas(clases_por_mes), clases_desbloqueadas, clases_totales")
      .eq("id", student.id)
      .maybeSingle();
    const s = studentData as {
      id: string; oferta_id: string | null; trial_teacher_id: string | null;
      commission_window_end: string | null; clases_desbloqueadas: number;
      clases_totales: number | null; classes_per_month: number | null;
      clases_por_mes: { clases_por_mes: number | null } | null;
    } | null;

    // Cadencia: de la oferta si existe; si no, de students.classes_per_month
    // (unificación 2026-08-21 — suscriptores legacy sin oferta también
    // desbloquean mes a mes).
    const perMonth = s?.clases_por_mes?.clases_por_mes ?? s?.classes_per_month ?? null;
    if (s && perMonth) {
      const cap = s.clases_totales ?? Infinity;
      const newUnlocked = Math.min(s.clases_desbloqueadas + perMonth, cap);
      await sb.from("students")
        .update({ clases_desbloqueadas: newUnlocked })
        .eq("id", s.id);
    }

    if (s?.trial_teacher_id && piId && isInCommissionWindow(s.commission_window_end)) {
      try {
        await registerCommission({
          teacherId: s.trial_teacher_id,
          studentId: s.id,
          amountCents: eurCents,
          currency: "EUR",
          stripePiId: piId,
          stripeInvoiceId: invoice.id,
          escenario: "E1",
        });
      } catch (err) {
        console.error("[stripe-webhook] registerCommission on renewal failed:", err);
      }
    }
  }

  if (customerEmail) await cutChainByEmail(sb, customerEmail);
}

async function handleSubscriptionChange(
  subscription: Stripe.Subscription,
): Promise<void> {
  const sb = supabaseAdmin();
  const customerId = typeof subscription.customer === "string"
    ? subscription.customer
    : (subscription.customer as { id: string }).id;

  const statusMap: Record<string, string> = {
    active: "active",
    past_due: "past_due",
    canceled: "canceled",
    unpaid: "past_due",
  };
  const mappedStatus = statusMap[subscription.status] ?? null;
  if (!mappedStatus) return;

  const { error } = await sb
    .from("students")
    .update({ stripe_subscription_status: mappedStatus })
    .eq("stripe_customer_id", customerId);
  if (error) {
    console.warn("[stripe-webhook] subscription status update failed:", error.message);
  }
}

function inferPaymentType(session: Stripe.Checkout.Session): string {
  if (session.mode === "subscription") return "subscription_payment";
  const meta = session.metadata ?? {};
  if (meta.pack_type) return "package";
  return "package";
}

async function cutChainByEmail(
  sb: ReturnType<typeof supabaseAdmin>,
  email: string,
): Promise<void> {
  try {
    const { data: lead } = await sb
      .from("leads")
      .select("id")
      .eq("email", email)
      .maybeSingle();
    if (lead) {
      await cancelActiveChain((lead as { id: string }).id, "payment_received");
    }
  } catch (err) {
    console.warn("[stripe-webhook] cutChainByEmail error:", err);
  }
}

type ResolvedStudent = { id: string; user_id: string } | null;

async function resolveStudent(
  sb: ReturnType<typeof supabaseAdmin>,
  opts: {
    stripeCustomerId?: string | null;
    metadata?: Record<string, string>;
    email?: string | null;
  },
  account: "us" | "de",
  eventSummary: string,
): Promise<ResolvedStudent> {
  // 1. By stripe_customer_id
  if (opts.stripeCustomerId) {
    const { data } = await sb
      .from("students")
      .select("id, user_id")
      .eq("stripe_customer_id", opts.stripeCustomerId)
      .maybeSingle();
    if (data) return data as { id: string; user_id: string };
  }

  // 2. By metadata.student_id
  if (opts.metadata?.student_id) {
    const { data } = await sb
      .from("students")
      .select("id, user_id")
      .eq("id", opts.metadata.student_id)
      .maybeSingle();
    if (data) return data as { id: string; user_id: string };
  }

  // 3. By email via users table
  if (opts.email) {
    const { data } = await sb
      .from("students")
      .select("id, user_id, users!inner(email)")
      .eq("users.email", opts.email)
      .maybeSingle();
    if (data) return data as { id: string; user_id: string };
  }

  // Not found — send admin alert
  await sendUnmatchedPaymentAlert(eventSummary, opts.email, opts.stripeCustomerId, account);
  return null;
}

async function sendUnmatchedPaymentAlert(
  eventSummary: string,
  email?: string | null,
  stripeCustomerId?: string | null,
  account?: "us" | "de",
): Promise<void> {
  const adminEmail = process.env.ADMIN_ALERT_EMAIL ?? "aprenderaleman2026@gmail.com";
  const subject = `⚠️ Pago Stripe sin estudiante — ${account?.toUpperCase() ?? "?"}`;
  const html = `
    <h3>Pago recibido sin estudiante asociado</h3>
    <ul>
      <li><strong>Evento:</strong> ${eventSummary}</li>
      <li><strong>Email:</strong> ${email ?? "desconocido"}</li>
      <li><strong>Stripe Customer:</strong> ${stripeCustomerId ?? "N/A"}</li>
      <li><strong>Cuenta:</strong> ${account?.toUpperCase() ?? "?"}</li>
    </ul>
    <p>Revisa el dashboard de Stripe y asigna el pago manualmente en /admin.</p>
  `;
  const text = `Pago Stripe sin estudiante. Evento: ${eventSummary}. Email: ${email ?? "?"}. Customer: ${stripeCustomerId ?? "N/A"}. Cuenta: ${account ?? "?"}`;
  try {
    await sendRaw(adminEmail, subject, html, text);
  } catch (err) {
    console.error("[stripe-webhook] sendUnmatchedPaymentAlert failed:", err);
  }
}
