import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getStripeClient } from "@/lib/stripe";
import { findPendingOfertaByEmail, convertLeadFromStripePayment } from "@/lib/lead-payment-match";

/**
 * POST /api/admin/stripe/assign-lead-payment
 * Asigna a mano un pago de Stripe que llegó "sin estudiante" (Payment
 * Link sin metadata) al lead con oferta pendiente y dispara la
 * conversión completa (bienvenida, profe, bono/comisión).
 *
 * Auth: admin/superadmin con sesión, o Bearer CRON_SECRET (operativa
 * desde fuera, p.ej. caso Jean 2026-10-15).
 *
 * Body: { email, account: "us"|"de", stripe_customer_id, stripe_pi_id,
 *         amount_cents, currency?, stripe_invoice_id?, stripe_subscription_id? }
 * Si no viene stripe_subscription_id, se busca en Stripe la suscripción
 * activa del customer.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  email:                  z.string().email(),
  account:                z.enum(["us", "de"]),
  stripe_customer_id:     z.string().min(3),
  stripe_pi_id:           z.string().min(3),
  amount_cents:           z.number().int().positive(),
  currency:               z.string().default("EUR"),
  stripe_invoice_id:      z.string().optional(),
  stripe_subscription_id: z.string().optional(),
});

export async function POST(req: Request) {
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  const isAdmin = !!session?.user && (role === "admin" || role === "superadmin");
  const isCron  = !!process.env.CRON_SECRET && bearer === process.env.CRON_SECRET;
  if (!isAdmin && !isCron) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });
  const b = parsed.data;

  const match = await findPendingOfertaByEmail(b.email);
  if (!match) return NextResponse.json({ error: "no_pending_oferta", message: "No hay lead con oferta pendiente para ese email." }, { status: 404 });

  let subId = b.stripe_subscription_id ?? null;
  if (!subId) {
    try {
      const subs = await getStripeClient(b.account).subscriptions.list({ customer: b.stripe_customer_id, status: "all", limit: 5 });
      const best = subs.data.find(s => s.status === "active" || s.status === "trialing") ?? subs.data[0];
      subId = best?.id ?? null;
    } catch (e) {
      console.warn("[assign-lead-payment] subscriptions.list failed:", e);
    }
  }

  await convertLeadFromStripePayment({
    match,
    stripeCustomerId:     b.stripe_customer_id,
    stripeSubscriptionId: subId,
    stripePiId:           b.stripe_pi_id,
    stripeInvoiceId:      b.stripe_invoice_id ?? null,
    amountCents:          b.amount_cents,
    currency:             b.currency.toUpperCase(),
    account:              b.account,
    source:               "asignación manual (admin)",
  });
  return NextResponse.json({ ok: true, lead_id: match.leadId, oferta_id: match.ofertaId, stripe_subscription_id: subId });
}
