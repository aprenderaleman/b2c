import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { resolveCloserActor } from "@/lib/closer-auth";
import { supabaseAdmin } from "@/lib/supabase";
import { stripeUS, findOrCreateCustomer } from "@/lib/stripe";
import { startChain } from "@/lib/chain-engine";
import { logCloserAction } from "@/lib/closer-actions";
import { RITMOS, ONE_TIME_PACKS, type RitmoId, type GoalId } from "@/lib/trial-packs";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://b2c.aprender-aleman.de").replace(/\/$/, "");

const ONE_TIME_CLASSES: Record<GoalId, number> = {
  a1_a2: 32, b1: 48, b2: 48, c1: 64, fluidez_total: 96,
};

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = await resolveCloserActor();
  if (!actor) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const closerId = actor.id;
  const { id: leadId } = await params;

  const sb = supabaseAdmin();
  const { data: lead } = await sb
    .from("leads")
    .select("closer_id, email, name")
    .eq("id", leadId)
    .single();

  if (!lead || (lead as { closer_id: string | null }).closer_id !== closerId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; }
  catch { return NextResponse.json({ error: "invalid_body" }, { status: 400 }); }

  const category = body.category as "subscription" | "one_time" | undefined;
  const ritmoId = body.ritmoId as RitmoId | undefined;
  const goalId = body.goalId as GoalId | undefined;

  if (!category) return NextResponse.json({ error: "missing_category" }, { status: 400 });

  let productName: string;
  let packLabel: string;
  let tipo_pago: "suscripcion" | "unico";
  let clases_totales: number;
  let clases_por_mes: number | null = null;
  let importe_cents: number;
  let monthlyPriceCents: number | null = null;
  let meta: string;
  let ritmo: string | null = null;

  if (category === "subscription") {
    if (!ritmoId || !goalId) return NextResponse.json({ error: "missing_ritmo_or_goal" }, { status: 400 });
    const r = RITMOS.find(x => x.id === ritmoId);
    const g = r?.goals.find(x => x.id === goalId);
    if (!r || !g) return NextResponse.json({ error: "invalid_plan" }, { status: 400 });

    meta = goalId;
    ritmo = ritmoId;
    tipo_pago = "suscripcion";
    clases_totales = g.months * r.classesPerMonth;
    clases_por_mes = r.classesPerMonth;
    importe_cents = g.totalCents;
    monthlyPriceCents = r.pricePerMonth * 100;
    packLabel = `${r.emoji} ${r.name} · Meta ${g.label} · ${g.months} meses`;
    productName = `${r.name} — Meta ${g.label}`;
  } else if (category === "one_time") {
    if (!goalId) return NextResponse.json({ error: "missing_goal" }, { status: 400 });
    const p = ONE_TIME_PACKS.find(x => x.id === goalId);
    if (!p) return NextResponse.json({ error: "invalid_pack" }, { status: 400 });

    meta = goalId;
    tipo_pago = "unico";
    clases_totales = ONE_TIME_CLASSES[goalId] ?? 32;
    importe_cents = p.priceCents;
    packLabel = p.name;
    productName = p.name;
  } else {
    return NextResponse.json({ error: "invalid_category" }, { status: 400 });
  }

  const leadRow = lead as { email: string | null; name: string | null };

  // Get teacher_id from trial class (for trazabilidad E2)
  const { data: trialClass } = await sb
    .from("classes")
    .select("teacher_id")
    .eq("lead_id", leadId)
    .eq("is_trial", true)
    .in("status", ["completed", "scheduled", "live"])
    .order("scheduled_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const teacherId = (trialClass as { teacher_id?: string } | null)?.teacher_id ?? null;

  const { data: oferta, error: insertErr } = await sb
    .from("ofertas_enviadas")
    .insert({
      lead_id: leadId,
      teacher_id: teacherId,
      closer_id: closerId,
      meta,
      ritmo,
      tipo_pago,
      clases_totales,
      clases_por_mes,
      importe_cents,
    })
    .select("id")
    .single();

  if (insertErr || !oferta) {
    console.error("[closer/send-offer] insert failed:", insertErr);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }

  const ofertaId = (oferta as { id: string }).id;

  let checkoutUrl: string;
  try {
    const stripe = stripeUS();
    const enrollmentMeta: Record<string, string> = {
      type: "enrollment",
      oferta_id: ofertaId,
      lead_id: leadId,
      closer_id: closerId,
      ...(teacherId ? { teacher_id: teacherId } : {}),
    };

    let customerId: string | undefined;
    if (leadRow.email) {
      try {
        customerId = await findOrCreateCustomer("us", {
          email: leadRow.email,
          name: leadRow.name ?? undefined,
          metadata: { lead_id: leadId },
        });
      } catch { /* fall back to customer_email */ }
    }

    const successUrl = `${SITE_URL}/inscripcion-exitosa?oferta=${ofertaId}`;
    const cancelUrl = `${SITE_URL}/`;

    let sessionParams: Stripe.Checkout.SessionCreateParams;

    if (tipo_pago === "suscripcion" && monthlyPriceCents) {
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
              description: `${clases_por_mes} clases/mes · ${clases_totales} clases en total`,
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
            unit_amount: importe_cents,
            product_data: {
              name: productName,
              description: `${clases_totales} clases de alemán`,
            },
          },
        }],
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: enrollmentMeta,
        payment_intent_data: { metadata: enrollmentMeta },
      };
    }

    const stripeSession = await stripe.checkout.sessions.create(sessionParams);
    checkoutUrl = stripeSession.url!;
  } catch (err) {
    console.error("[closer/send-offer] Stripe error:", err);
    return NextResponse.json({ error: "stripe_error" }, { status: 502 });
  }

  await sb.from("lead_timeline").insert({
    lead_id: leadId,
    type: "agent_note",
    author: "closer",
    content: `Enlace de inscripcion enviado: ${packLabel} · ${(importe_cents / 100).toLocaleString("es-ES")} €`,
    metadata: {
      kind: "offer_sent",
      oferta_id: ofertaId,
      closer_id: closerId,
      category,
    },
  });

  await logCloserAction({
    closerId,
    leadId,
    tipo: "nota",
    contenido: `Enlace de inscripcion: ${packLabel}`,
    resultado: "mensaje_enviado",
  });

  await startChain(leadId, "chain2_link_sent", {
    fullUrl: checkoutUrl,
    packLabel,
  });

  return NextResponse.json({ ok: true, ofertaId, checkoutUrl });
}
