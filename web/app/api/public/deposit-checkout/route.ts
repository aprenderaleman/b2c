import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { supabaseAdmin } from "@/lib/supabase";
import { verifyTrialToken } from "@/lib/trial-token";
import { stripeUS, findOrCreateCustomer } from "@/lib/stripe";
import { reportError } from "@/lib/error-reporting";

/**
 * POST /api/public/deposit-checkout
 *
 * Crea una Stripe Checkout Session para el depósito opcional de 10€
 * ("Reserva Prioritaria") tras agendar la clase de prueba. Se llama
 * desde el botón inline en /confirmacion.
 *
 * Cuenta Stripe: US (decisión Gelfis 2026-07-24). Producto/precio ya
 * existente — se referencia por STRIPE_DEPOSIT_PRICE_ID_US. Fallback a
 * price_data inline si la env no está seteada.
 *
 * Persiste el fbclid (si lo trae el body) en leads.fbclid como
 * respaldo por si el cookie _fbc de Meta se pierde en el roundtrip a
 * Stripe. El fbc en producción se obtiene del cookie server-side en
 * /api/meta-capi.
 *
 * success_url vuelve a /confirmacion con ?deposito=ok — ahí el
 * componente ConfirmacionDepositPurchase dispara los eventos Purchase.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://b2c.aprender-aleman.de").replace(/\/$/, "");

export async function POST(req: Request) {
  try {
    return await handle(req);
  } catch (err) {
    // Cualquier throw sync/async (stripeUS() sin env, supabaseAdmin() sin
    // env, verifyTrialToken sin NEXTAUTH_SECRET, supabase query errors,
    // etc.) cae aquí en vez del 500 opaco de Next.js.
    await reportError(err, { endpoint: "deposit-checkout" });
    return NextResponse.json({
      ok:     false,
      error:  "server_error",
      detail: (err as { message?: string }).message ?? "unknown",
    }, { status: 502 });
  }
}

async function handle(req: Request) {
  let body: {
    classId?: string;
    token?:   string;
    fbclid?:  string;
    landing?: string;
  };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }

  const { classId, token, fbclid } = body;
  if (!classId || !token) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  // Mismo token de /confirmacion — HMAC del classId. Impide que
  // cualquiera invoque este endpoint con un classId adivinado.
  const payload = verifyTrialToken(token);
  if (!payload || payload.class_id !== classId) {
    return NextResponse.json({ error: "invalid_token" }, { status: 401 });
  }

  const sb = supabaseAdmin();
  const { data: cls } = await sb
    .from("classes")
    .select("id, lead_id, is_trial, sesion_closer_id")
    .eq("id", classId)
    .maybeSingle();
  // Aceptamos tanto trials (is_trial=true) como Sesiones de Plan
  // (sesion_closer_id NOT NULL) — mismo producto Reserva Prioritaria
  // de 10€, mismo lock del slot, mismo descuento al pack.
  const clsRow = cls as { is_trial: boolean; sesion_closer_id: string | null; lead_id: string } | null;
  const isTrial  = clsRow?.is_trial === true;
  const isSesion = Boolean(clsRow?.sesion_closer_id);
  if (!clsRow || (!isTrial && !isSesion)) {
    return NextResponse.json({ error: "trial_not_found" }, { status: 404 });
  }
  const leadId = clsRow.lead_id;

  const { data: leadRow } = await sb
    .from("leads")
    .select("id, email, whatsapp_normalized, reserva_prioritaria")
    .eq("id", leadId)
    .maybeSingle();
  const lead = leadRow as {
    id: string;
    email: string | null;
    whatsapp_normalized: string | null;
    reserva_prioritaria: boolean;
  } | null;

  if (!lead) return NextResponse.json({ error: "lead_not_found" }, { status: 404 });
  if (lead.reserva_prioritaria) {
    return NextResponse.json({ error: "already_paid" }, { status: 409 });
  }

  // Backup del fbclid en la BD por si el cookie _fbc no sobrevive.
  // No bloquea si el update falla (mejor que romper la conversión).
  if (fbclid && fbclid.length < 500) {
    await sb.from("leads").update({ fbclid }).eq("id", leadId).then(() => {}, () => {});
  }

  const stripe = stripeUS();
  const returnQuery = `c=${encodeURIComponent(classId)}&t=${encodeURIComponent(token)}`;
  const successUrl = `${SITE_URL}/confirmacion?${returnQuery}&deposito=ok`;
  const cancelUrl  = `${SITE_URL}/confirmacion?${returnQuery}`;

  let customerId: string | undefined;
  if (lead.email) {
    try {
      customerId = await findOrCreateCustomer("us", {
        email: lead.email,
        metadata: { lead_id: leadId },
      });
    } catch (err) {
      console.warn("[deposit-checkout] findOrCreateCustomer failed, falling back to customer_email:", err);
    }
  }

  const priceId = process.env.STRIPE_DEPOSIT_PRICE_ID_US;
  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = priceId
    ? [{ price: priceId, quantity: 1 }]
    : [{
        quantity: 1,
        price_data: {
          currency: "eur",
          unit_amount: 1000,
          product_data: {
            name: "Reserva Prioritaria — Clase de prueba",
            description: "Asegura tu plaza. Se descuenta del pack si continúas.",
          },
        },
      }];

  console.log("[deposit-checkout] creating session", {
    lead_id:  leadId,
    class_id: classId,
    priceId:  priceId ?? "(inline price_data)",
    success:  successUrl,
    customerId: customerId ?? "(email fallback)",
  });

  let session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      ...(customerId ? { customer: customerId } : { customer_email: lead.email ?? undefined }),
      line_items: lineItems,
      success_url: successUrl,
      cancel_url:  cancelUrl,
      metadata: {
        type:     "trial_deposit",
        lead_id:  leadId,
        class_id: classId,
      },
      payment_intent_data: {
        metadata: {
          type:     "trial_deposit",
          lead_id:  leadId,
          class_id: classId,
        },
      },
    });
  } catch (err) {
    // Errores típicos de Stripe: Price ID inválido / recurring en modo
    // payment, secret key mal cargada, cuenta desactivada, etc. Los
    // logueamos con detalle para poder diagnosticar desde Vercel Logs.
    const e = err as { type?: string; code?: string; message?: string; raw?: { message?: string } };
    console.error("[deposit-checkout] Stripe error:", {
      type:    e.type,
      code:    e.code,
      message: e.message,
      raw:     e.raw?.message,
    });
    return NextResponse.json({
      ok:     false,
      error:  "stripe_error",
      detail: e.message ?? "unknown",
      code:   e.code,
      type:   e.type,
    }, { status: 502 });
  }

  if (!session.url) {
    return NextResponse.json({ error: "no_checkout_url" }, { status: 502 });
  }

  console.log("[deposit-checkout] session created", { id: session.id, url_head: session.url.slice(0, 60) });
  return NextResponse.json({ ok: true, url: session.url });
}
