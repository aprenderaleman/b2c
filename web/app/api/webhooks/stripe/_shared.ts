import type Stripe from "stripe";
import { supabaseAdmin } from "@/lib/supabase";
import { getStripeClient } from "@/lib/stripe";
import { getExchangeRate, convertToEur } from "@/lib/exchange-rates";

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

  if (!customerEmail || amountTotal === 0) return;

  // Check if payment already exists (by payment_intent_id)
  if (paymentIntentId) {
    const { data: dup } = await sb
      .from("payments")
      .select("id")
      .eq("stripe_payment_intent_id", paymentIntentId)
      .maybeSingle();
    if (dup) return;
  }

  // Find student by email
  const { data: student } = await sb
    .from("students")
    .select("id, users!inner(email)")
    .eq("users.email", customerEmail)
    .maybeSingle();

  if (!student) {
    console.warn(`Stripe payment for unknown student: ${customerEmail}`);
    return;
  }

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
}

async function handlePaymentIntentSucceeded(
  pi: Stripe.PaymentIntent,
  account: "us" | "de",
): Promise<void> {
  const sb = supabaseAdmin();

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

  if (!customerEmail || pi.amount === 0) return;

  const { data: student } = await sb
    .from("students")
    .select("id, users!inner(email)")
    .eq("users.email", customerEmail)
    .maybeSingle();
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

  // Skip if already handled by checkout or payment_intent events
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
  if (!customerEmail) return;

  const { data: student } = await sb
    .from("students")
    .select("id, users!inner(email)")
    .eq("users.email", customerEmail)
    .maybeSingle();
  if (!student) return;

  const rate = await getExchangeRate(currency, "EUR");
  const eurCents = convertToEur(amountPaid, currency, rate);

  const isSubscription = invoice.lines?.data?.some(
    (line) => (line as unknown as { type?: string }).type === "subscription" || line.description?.includes("×"),
  );

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
    stripe_account: account,
    original_currency: currency,
    original_amount_cents: amountPaid,
    exchange_rate: rate,
    stripe_charge_id: null,
  });
}

function inferPaymentType(session: Stripe.Checkout.Session): string {
  if (session.mode === "subscription") return "subscription_payment";
  const meta = session.metadata ?? {};
  if (meta.pack_type) return "package";
  return "package";
}
