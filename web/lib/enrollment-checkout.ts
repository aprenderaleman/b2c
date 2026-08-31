import type Stripe from "stripe";
import { supabaseAdmin } from "./supabase";
import { stripeUS, findOrCreateCustomer } from "./stripe";
import { RITMOS, ONE_TIME_PACKS, type RitmoId, type GoalId } from "./trial-packs";
import { TERMS_VERSION, TERMS_URL, TERMS_CHECKOUT_TEXT } from "./terms";

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
export async function createEnrollmentCheckoutSession(
  ofertaId: string,
  /** IP y user-agent del visitante del link — para el registro legal
   *  de aceptación de TyC (terms_acceptances, migración 124). */
  visitor?: { ip?: string | null; userAgent?: string | null },
): Promise<
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

    // Consentimiento legal (FASE 2, TyC condiciones-es-v2.0): checkbox
    // de TyC en Stripe Checkout con el texto §10.2 de inicio inmediato.
    // Requiere que la cuenta Stripe tenga la URL de TyC configurada en
    // Settings → Public details; si no la tiene, el create falla — por
    // eso el fallback de abajo reintenta SIN consent para que un tema
    // de configuración jamás bloquee un pago.
    const consentParams: Pick<Stripe.Checkout.SessionCreateParams, "consent_collection" | "custom_text"> = {
      consent_collection: { terms_of_service: "required" },
      custom_text: { terms_of_service_acceptance: { message: TERMS_CHECKOUT_TEXT } },
    };

    let session: Stripe.Checkout.Session;
    let consentShown = true;
    try {
      session = await stripe.checkout.sessions.create({ ...sessionParams, ...consentParams });
    } catch (consentErr) {
      console.error(
        "[enrollment-checkout] CRITICAL: session con consent_collection falló — reintentando SIN checkbox de TyC. " +
        "Revisar la URL de Términos en Stripe Settings → Public details.",
        consentErr instanceof Error ? consentErr.message : consentErr,
      );
      consentShown = false;
      session = await stripe.checkout.sessions.create(sessionParams);
    }
    if (!session.url) return { ok: false, reason: "stripe_error" };

    // Registro legal: una fila por session creada. El webhook
    // checkout.session.completed la completa con el consent real.
    await sb.from("terms_acceptances").insert({
      lead_id:           of.lead_id,
      oferta_id:         of.id,
      email:             leadRow.email,
      terms_version:     TERMS_VERSION,
      terms_url:         TERMS_URL,
      ip:                visitor?.ip ?? null,
      user_agent:        visitor?.userAgent ?? null,
      stripe_session_id: session.id,
      // Si el fallback quitó el checkbox, dejamos constancia de que el
      // §10.2 NO se mostró en esta session.
      immediate_start_consent: false,
      tos_consent:       consentShown ? null : "not_shown",
    }).then(({ error }) => {
      if (error) console.error("[enrollment-checkout] terms_acceptances insert failed:", error.message);
    });

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
