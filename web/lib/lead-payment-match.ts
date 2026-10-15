import { supabaseAdmin } from "@/lib/supabase";
import { handleFirstPayment } from "@/lib/auto-conversion";

/**
 * Pagos de Stripe que llegan SIN metadata de oferta (Payment Links
 * buy.stripe.com del flujo post-clase). Caso Zulma (oct 2026) y Jean
 * (2026-10-15): el lead pagaba, el webhook solo buscaba `students`, no
 * encontraba nada y mandaba la alerta "Pago sin estudiante" — sin
 * conversión, sin bienvenida, sin aviso al profe.
 *
 * Aquí casamos el email del pagador con un LEAD que tenga una oferta
 * pendiente (enviada y no aceptada) y lanzamos el mismo flujo que el
 * checkout con metadata: handleFirstPayment → convierte, saldo,
 * bono/comisión, bienvenida, aviso al profe.
 */
export type PendingOfertaMatch = { leadId: string; ofertaId: string; leadName: string | null; ritmo: string | null; tipoPago: string };

export async function findPendingOfertaByEmail(email: string | null | undefined): Promise<PendingOfertaMatch | null> {
  const e = (email ?? "").trim().toLowerCase();
  if (!e) return null;
  const sb = supabaseAdmin();
  const { data: leads } = await sb
    .from("leads")
    .select("id, name, converted_to_user_id")
    .ilike("email", e)
    .is("converted_to_user_id", null)
    .order("created_at", { ascending: false })
    .limit(5);
  for (const l of (leads ?? []) as Array<{ id: string; name: string | null }>) {
    const since = new Date(Date.now() - 45 * 24 * 3600_000).toISOString();
    const { data: of } = await sb
      .from("ofertas_enviadas")
      .select("id, ritmo, tipo_pago")
      .eq("lead_id", l.id)
      .is("accepted_at", null)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (of) {
      const o = of as { id: string; ritmo: string | null; tipo_pago: string };
      return { leadId: l.id, ofertaId: o.id, leadName: l.name, ritmo: o.ritmo, tipoPago: o.tipo_pago };
    }
  }
  return null;
}

export async function convertLeadFromStripePayment(args: {
  match: PendingOfertaMatch;
  stripeCustomerId: string;
  stripeSubscriptionId?: string | null;
  stripePiId: string;
  stripeInvoiceId?: string | null;
  amountCents: number;
  currency: string;
  account: "us" | "de";
  source: string;                   // p.ej. "checkout.session.completed cs_…"
}): Promise<void> {
  await handleFirstPayment({
    leadId:               args.match.leadId,
    ofertaId:             args.match.ofertaId,
    stripeCustomerId:     args.stripeCustomerId,
    stripeSubscriptionId: args.stripeSubscriptionId ?? null,
    stripePiId:           args.stripePiId,
    stripeInvoiceId:      args.stripeInvoiceId ?? null,
    amountCents:          args.amountCents,
    currency:             args.currency,
    account:              args.account,
  });
  try {
    await supabaseAdmin().from("lead_timeline").insert({
      lead_id: args.match.leadId,
      type:    "note",
      content: `💳 Pago Stripe (${args.account.toUpperCase()}) casado por email con la oferta ${args.match.ritmo ?? ""} ${args.match.tipoPago} · ${(args.amountCents / 100).toFixed(2)} ${args.currency} · ${args.source}`,
      metadata: { kind: "stripe_lead_match", pi: args.stripePiId, customer: args.stripeCustomerId },
    });
  } catch { /* timeline opcional */ }
}
