import { NextResponse } from "next/server";
import { z } from "zod";
import type Stripe from "stripe";
import { auth } from "@/lib/auth";
import { getStripeClient } from "@/lib/stripe";

/**
 * POST /api/admin/stripe/subscription
 *
 * Operaciones puntuales sobre la suscripción activa de un alumno, por
 * email (caso fin del Dúo Annette/Gastón, Gelfis 2026-11-02):
 *
 *   { action: "inspect", email }
 *       → customer, suscripción activa, saldo del customer y últimas facturas.
 *   { action: "set_price", email, amountCents, nickname? }
 *       → cambia el ítem de la suscripción a un price recurrente mensual
 *         de ese importe (reutiliza uno existente o lo crea), SIN prorrateo
 *         y sin mover el ancla: el nuevo importe se cobra en la próxima
 *         renovación.
 *   { action: "cancel", email, atPeriodEnd? }
 *       → cancela la suscripción (inmediata por defecto; no reembolsa).
 *
 * Auth: admin/superadmin o Bearer CRON_SECRET (las claves de Stripe solo
 * viven en Vercel).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("inspect"),   account: z.enum(["us", "de"]).default("us"), email: z.string().email() }),
  z.object({ action: z.literal("set_price"), account: z.enum(["us", "de"]).default("us"), email: z.string().email(),
             amountCents: z.number().int().min(1000).max(200_000), nickname: z.string().trim().min(1).max(80).optional() }),
  z.object({ action: z.literal("cancel"),    account: z.enum(["us", "de"]).default("us"), email: z.string().email(),
             atPeriodEnd: z.boolean().default(false) }),
]);

async function authorised(req: Request): Promise<boolean> {
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (process.env.CRON_SECRET && bearer === process.env.CRON_SECRET) return true;
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  return role === "admin" || role === "superadmin";
}

async function findActive(stripe: Stripe, email: string): Promise<{ customer: Stripe.Customer; sub: Stripe.Subscription } | null> {
  const customers = await stripe.customers.list({ email, limit: 5 });
  for (const c of customers.data) {
    const subs = await stripe.subscriptions.list({ customer: c.id, status: "active", limit: 5 });
    if (subs.data.length > 0) return { customer: c, sub: subs.data[0] };
  }
  return null;
}

function periodEnd(sub: Stripe.Subscription): string | null {
  const item = sub.items.data[0];
  const sec = (item as unknown as { current_period_end?: number })?.current_period_end
    ?? (sub as unknown as { current_period_end?: number }).current_period_end ?? null;
  return sec ? new Date(sec * 1000).toISOString().slice(0, 10) : null;
}

export async function POST(req: Request) {
  if (!(await authorised(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "validation_failed", details: parsed.error.flatten() }, { status: 400 });
  const b = parsed.data;

  let stripe: Stripe;
  try { stripe = getStripeClient(b.account); }
  catch { return NextResponse.json({ error: "stripe_not_configured", account: b.account }, { status: 503 }); }

  try {
    const found = await findActive(stripe, b.email);
    if (!found) return NextResponse.json({ error: "active_subscription_not_found", email: b.email }, { status: 404 });
    const { customer, sub } = found;
    const item = sub.items.data[0];

    if (b.action === "inspect") {
      const invoices = await stripe.invoices.list({ customer: customer.id, limit: 6 });
      return NextResponse.json({
        ok: true,
        customerId: customer.id,
        balanceCents: customer.balance,
        subscription: {
          id: sub.id, status: sub.status, cancelAtPeriodEnd: sub.cancel_at_period_end,
          priceId: item.price.id, amountCents: item.price.unit_amount, nickname: item.price.nickname,
          interval: item.price.recurring?.interval, currentPeriodEnd: periodEnd(sub), metadata: sub.metadata,
        },
        invoices: invoices.data.map(i => ({
          id: i.id, status: i.status, amountPaidCents: i.amount_paid, amountDueCents: i.amount_due,
          created: new Date(i.created * 1000).toISOString().slice(0, 10),
          paymentIntent: (i as unknown as { payment_intent?: string | { id: string } | null }).payment_intent ?? null,
        })),
      });
    }

    if (b.action === "set_price") {
      const prices = await stripe.prices.list({ active: true, type: "recurring", limit: 100 });
      let price = prices.data.find(p =>
        p.unit_amount === b.amountCents && p.currency === "eur" &&
        p.recurring?.interval === "month" && p.recurring?.interval_count === 1 &&
        (!b.nickname || (p.nickname ?? "").toLowerCase().includes(b.nickname.toLowerCase())),
      ) ?? null;
      let created = false;
      if (!price) {
        const product = await stripe.products.create({ name: b.nickname ?? `Plan ${(b.amountCents / 100).toFixed(0)} €/mes` });
        price = await stripe.prices.create({
          product: product.id, unit_amount: b.amountCents, currency: "eur",
          recurring: { interval: "month" }, nickname: b.nickname ?? `Plan ${(b.amountCents / 100).toFixed(0)}/mes`,
        });
        created = true;
      }
      const already = item.price.id === price.id;
      if (!already) {
        await stripe.subscriptions.update(sub.id, {
          items: [{ id: item.id, price: price.id }],
          proration_behavior: "none",
        });
      }
      return NextResponse.json({
        ok: true, subscriptionId: sub.id, previousPriceId: item.price.id, previousAmountCents: item.price.unit_amount,
        newPriceId: price.id, newAmountCents: price.unit_amount, priceCreated: created, priceChanged: !already,
        balanceCents: customer.balance, nextRenewal: periodEnd(sub),
      });
    }

    // cancel
    if (b.atPeriodEnd) {
      const upd = await stripe.subscriptions.update(sub.id, { cancel_at_period_end: true });
      return NextResponse.json({ ok: true, subscriptionId: sub.id, status: upd.status, cancelAtPeriodEnd: true, endsOn: periodEnd(sub) });
    }
    const cancelled = await stripe.subscriptions.cancel(sub.id, { prorate: false });
    return NextResponse.json({ ok: true, subscriptionId: sub.id, status: cancelled.status, cancelledAt: cancelled.canceled_at ? new Date(cancelled.canceled_at * 1000).toISOString() : null });
  } catch (e) {
    return NextResponse.json({ error: "exception", message: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
