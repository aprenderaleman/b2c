import { NextRequest, NextResponse } from "next/server";
import { getStripeClient } from "@/lib/stripe";

/**
 * POST /api/internal/stripe-lookup  { email }
 *
 * Herramienta de diagnóstico interna: busca el customer y sus
 * suscripciones en ambas cuentas de Stripe por email. Solo lectura.
 * Auth: Bearer CRON_SECRET (las claves de Stripe viven solo en Vercel).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { email?: string } = {};
  try { body = await req.json(); } catch { /* below */ }
  const email = (body.email ?? "").trim().toLowerCase();
  if (!email) return NextResponse.json({ error: "email_required" }, { status: 400 });

  const out: Record<string, unknown[]> = {};
  for (const account of ["us", "de"] as const) {
    out[account] = [];
    let stripe;
    try { stripe = getStripeClient(account); } catch { continue; }
    try {
      const res = await stripe.customers.search({ query: `email:'${email.replace(/'/g, "")}'`, limit: 5 });
      for (const cust of res.data) {
        const subs = await stripe.subscriptions.list({ customer: cust.id, status: "all", limit: 5 });
        out[account].push({
          customer_id: cust.id,
          name: cust.name,
          subscriptions: subs.data.map(s => ({
            id: s.id,
            status: s.status,
            amount: (s.items.data[0]?.price?.unit_amount ?? 0) / 100,
            interval: s.items.data[0]?.price?.recurring?.interval ?? null,
            current_period_end: new Date(s.current_period_end * 1000).toISOString().slice(0, 10),
            metadata: s.metadata,
          })),
        });
      }
    } catch (e) {
      out[account].push({ error: e instanceof Error ? e.message.slice(0, 120) : "unknown" });
    }
  }
  return NextResponse.json({ ok: true, email, accounts: out });
}
