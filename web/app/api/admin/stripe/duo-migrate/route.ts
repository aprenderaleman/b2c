import { NextResponse } from "next/server";
import { z } from "zod";
import type Stripe from "stripe";
import { auth } from "@/lib/auth";
import { getStripeClient } from "@/lib/stripe";

/**
 * POST /api/admin/stripe/duo-migrate
 *
 * Migración al plan Dúo (caso Annette, primer Dúo — Gelfis 2026-10-09).
 * Hace, en orden y de forma idempotente:
 *   1. Localiza el customer por email y su suscripción activa.
 *   2. Busca (o crea) el price recurrente "Plan Dúo" de 250 €/mes.
 *   3. Cambia el ítem de la suscripción al price Dúo SIN prorrateo y sin
 *      tocar el ancla de ciclo (misma tarjeta, misma fecha).
 *   4. Aplica crédito de balance (p. ej. −70 €) para que la próxima
 *      factura salga 250 − 70 = 180 € y 250 € en adelante.
 *   5. Crea un Payment Link del mismo price para la pareja.
 *
 * Con { dryRun: true } solo informa lo que haría (paso 1 + price check).
 * Auth: admin/superadmin o Bearer CRON_SECRET (ejecución por CLI).
 */

const Body = z.object({
  account:          z.enum(["de", "us"]).default("de"),
  email:            z.string().email(),
  creditCents:      z.number().int().min(0).max(100_000).default(7000),
  duoPriceCents:    z.number().int().min(1000).max(200_000).default(25000),
  dryRun:           z.boolean().default(false),
});

export async function POST(req: Request) {
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  const cronOk = Boolean(process.env.CRON_SECRET) && bearer === process.env.CRON_SECRET;
  if (!cronOk) {
    const session = await auth();
    const role = (session?.user as { role?: string } | undefined)?.role;
    if (!session?.user || (role !== "admin" && role !== "superadmin")) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed", details: parsed.error.flatten() }, { status: 400 });
  }
  const { account, email, creditCents, duoPriceCents, dryRun } = parsed.data;

  let stripe: Stripe;
  try { stripe = getStripeClient(account); }
  catch { return NextResponse.json({ error: "stripe_not_configured" }, { status: 503 }); }

  // 1. Customer + suscripción activa
  const customers = await stripe.customers.list({ email, limit: 5 });
  if (customers.data.length === 0) {
    return NextResponse.json({ error: "customer_not_found", email }, { status: 404 });
  }
  let customer: Stripe.Customer | null = null;
  let sub: Stripe.Subscription | null = null;
  for (const c of customers.data) {
    const subs = await stripe.subscriptions.list({ customer: c.id, status: "active", limit: 5 });
    if (subs.data.length > 0) { customer = c; sub = subs.data[0]; break; }
  }
  if (!customer || !sub) {
    return NextResponse.json({ error: "active_subscription_not_found", customers: customers.data.map(c => c.id) }, { status: 404 });
  }
  const item = sub.items.data[0];
  const currentPrice = item.price;

  // 2. Price "Plan Dúo" — reusar si ya existe (mismo importe/recurrencia)
  let duoPrice: Stripe.Price | null = null;
  const prices = await stripe.prices.list({ active: true, type: "recurring", limit: 100 });
  duoPrice = prices.data.find(p =>
    p.unit_amount === duoPriceCents &&
    p.currency === "eur" &&
    p.recurring?.interval === "month" &&
    (p.nickname ?? "").toLowerCase().includes("duo"),
  ) ?? null;

  if (dryRun) {
    return NextResponse.json({
      ok: true, dryRun: true,
      customerId: customer.id,
      subscriptionId: sub.id,
      currentPrice: { id: currentPrice.id, amount: currentPrice.unit_amount, interval: currentPrice.recurring?.interval },
      currentPeriodEnd: new Date((sub as unknown as { current_period_end: number }).current_period_end * 1000).toISOString(),
      existingDuoPrice: duoPrice?.id ?? null,
      wouldCredit: creditCents,
    });
  }

  if (!duoPrice) {
    const product = await stripe.products.create({
      name: "Plan Dúo — 250 €/mes por persona",
      description: "Clases de alemán en pareja (90 min compartidos). 250 €/mes por persona.",
    });
    duoPrice = await stripe.prices.create({
      product:     product.id,
      unit_amount: duoPriceCents,
      currency:    "eur",
      recurring:   { interval: "month" },
      nickname:    "Plan Dúo 250/mes",
    });
  }

  // 3. Cambiar el ítem de la suscripción — SIN prorrateo, mismo ancla.
  const already = currentPrice.id === duoPrice.id;
  if (!already) {
    await stripe.subscriptions.update(sub.id, {
      items: [{ id: item.id, price: duoPrice.id }],
      proration_behavior: "none",
    });
  }

  // 4. Crédito de balance (negativo = a favor del cliente). Idempotencia
  // básica: si ya existe una transacción con nuestra descripción, no
  // duplicar.
  let creditApplied = false;
  if (creditCents > 0) {
    const DESC = "Crédito migración a Plan Dúo (diferencia 320→250 del mes en curso)";
    const txs = await stripe.customers.listBalanceTransactions(customer.id, { limit: 20 });
    const dup = txs.data.some(t => t.description === DESC);
    if (!dup) {
      await stripe.customers.createBalanceTransaction(customer.id, {
        amount:      -creditCents,
        currency:    "eur",
        description: DESC,
      });
      creditApplied = true;
    }
  }

  // 5. Payment Link del Dúo para la pareja
  const link = await stripe.paymentLinks.create({
    line_items: [{ price: duoPrice.id, quantity: 1 }],
  });

  return NextResponse.json({
    ok: true,
    customerId:       customer.id,
    subscriptionId:   sub.id,
    previousPriceId:  currentPrice.id,
    duoPriceId:       duoPrice.id,
    priceChanged:     !already,
    creditApplied,
    creditCents,
    partnerPaymentLink: link.url,
    nextCycleEstimate: `${((duoPriceCents - creditCents) / 100).toFixed(2)} € el próximo ciclo, luego ${(duoPriceCents / 100).toFixed(2)} €/mes`,
  });
}
