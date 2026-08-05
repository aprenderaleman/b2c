import type Stripe from "stripe";
import { supabaseAdmin } from "./supabase";
import { stripeUS, findOrCreateCustomer } from "./stripe";
import { RITMOS, ONE_TIME_PACKS, type RitmoId, type GoalId } from "./trial-packs";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://b2c.aprender-aleman.de").replace(/\/$/, "");

/**
 * Crea (o re-crea) la Stripe Checkout Session para una oferta.
 *
 * Se usa desde /pago/[ofertaId] — el link corto que se envía al lead
 * por WhatsApp en vez de la URL cruda de checkout.stripe.com (caso
 * Nancy 2026-08-05: el link de 500+ chars parecía sospechoso).
 *
 * Ventaja extra: las Checkout Sessions caducan a las 24h. Como la
 * session se crea al VISITAR el link, el link corto nunca caduca —
 * cada visita genera una session fresca.
 */
export async function createEnrollmentCheckoutSession(ofertaId: string): Promise<
  | { ok: true; url: string }
  | { ok: false; reason: "not_found" | "already_accepted" | "stripe_error" }
> {
  const sb = supabaseAdmin();

  const { data: oferta } = await sb
    .from("ofertas_enviadas")
    .select("id, lead_id, teacher_id, closer_id, meta, ritmo, tipo_pago, clases_totales, clases_por_mes, importe_cents, accepted_at")
    .eq("id", ofertaId)
    .maybeSingle();
  if (!oferta) return { ok: false, reason: "not_found" };

  const of = oferta as {
    id: string; lead_id: string; teacher_id: string | null; closer_id: string | null;
    meta: string; ritmo: string | null; tipo_pago: string;
    clases_totales: number; clases_por_mes: number | null;
    importe_cents: number; accepted_at: string | null;
  };
  if (of.accepted_at) return { ok: false, reason: "already_accepted" };

  const { data: lead } = await sb
    .from("leads")
    .select("email, name")
    .eq("id", of.lead_id)
    .maybeSingle();
  const leadRow = (lead ?? { email: null, name: null }) as { email: string | null; name: string | null };

  const ritmo = of.ritmo ? RITMOS.find(r => r.id === (of.ritmo as RitmoId)) : null;
  const goal  = ritmo?.goals.find(g => g.id === of.meta);
  const oneTimePack = ONE_TIME_PACKS.find(p => p.id === (of.meta as GoalId));
  const productName =
    ritmo && goal      ? `${ritmo.name} — Meta ${goal.label}` :
    of.meta === "kids" ? "Pack Kids — Alemán para niños" :
    oneTimePack        ? oneTimePack.name :
    `Pack ${of.meta}`;
  const monthlyPriceCents = ritmo ? ritmo.pricePerMonth * 100 : null;

  try {
    const stripe = stripeUS();
    const enrollmentMeta: Record<string, string> = {
      type: "enrollment",
      oferta_id: of.id,
      lead_id: of.lead_id,
      ...(of.closer_id ? { closer_id: of.closer_id } : {}),
      ...(of.teacher_id ? { teacher_id: of.teacher_id } : {}),
    };

    let customerId: string | undefined;
    if (leadRow.email) {
      try {
        customerId = await findOrCreateCustomer("us", {
          email: leadRow.email,
          name: leadRow.name ?? undefined,
          metadata: { lead_id: of.lead_id },
        });
      } catch { /* fall back to customer_email */ }
    }

    const successUrl = `${SITE_URL}/inscripcion-exitosa?oferta=${of.id}`;
    const cancelUrl = `${SITE_URL}/`;

    let sessionParams: Stripe.Checkout.SessionCreateParams;
    if (of.tipo_pago === "suscripcion" && monthlyPriceCents) {
      sessionParams = {
        mode: "subscription",
        ...(customerId ? { customer: customerId } : { customer_email: leadRow.email ?? undefined }),
        line_items: [{
          quantity: 1,
          price_data: {
            currency: "eur",
            unit_amount: monthlyPriceCents,
            recurring: { interval: "month" },
            product_data: {
              name: productName,
              description: `${of.clases_por_mes} clases/mes · ${of.clases_totales} clases en total`,
            },
          },
        }],
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: enrollmentMeta,
        subscription_data: { metadata: enrollmentMeta },
      };
    } else {
      sessionParams = {
        mode: "payment",
        payment_method_types: ["card"],
        ...(customerId ? { customer: customerId } : { customer_email: leadRow.email ?? undefined }),
        line_items: [{
          quantity: 1,
          price_data: {
            currency: "eur",
            unit_amount: of.importe_cents,
            product_data: {
              name: productName,
              description: `${of.clases_totales} clases de alemán`,
            },
          },
        }],
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: enrollmentMeta,
        payment_intent_data: { metadata: enrollmentMeta },
      };
    }

    const session = await stripe.checkout.sessions.create(sessionParams);
    if (!session.url) return { ok: false, reason: "stripe_error" };
    return { ok: true, url: session.url };
  } catch (err) {
    console.error("[enrollment-checkout] Stripe error:", err);
    return { ok: false, reason: "stripe_error" };
  }
}

/** URL corta que se comparte con el lead. */
export function buildPagoUrl(ofertaId: string): string {
  return `${SITE_URL}/pago/${ofertaId}`;
}
