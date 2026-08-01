import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { requireTeacherSession, assertTeacherOwnsTrialLead } from "@/lib/teacher-trial-auth";
import { markTrialAttendedAwaitingConversion, type AttendedOptions } from "@/lib/admin-actions";
import { supabaseAdmin } from "@/lib/supabase";
import { stripeUS, findOrCreateCustomer } from "@/lib/stripe";
import {
  RITMOS, ONE_TIME_PACKS, KIDS_PACK,
  type RitmoId, type GoalId, type PlanCategory, type PaymentType,
} from "@/lib/trial-packs";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://b2c.aprender-aleman.de").replace(/\/$/, "");

const CLASSES_PER_MONTH: Record<RitmoId, number> = {
  viajero: 6, estandar: 8, intensivo: 12, vip_express: 16,
};

const ONE_TIME_CLASSES: Record<GoalId, number> = {
  a1_a2: 32, b1: 48, b2: 48, c1: 64, fluidez_total: 96,
};

export async function POST(req: Request, { params }: { params: Promise<{ leadId: string }> }) {
  let user;
  try { user = await requireTeacherSession(); }
  catch { return NextResponse.json({ error: "unauthorized" }, { status: 401 }); }

  const { leadId } = await params;

  try { await assertTeacherOwnsTrialLead(user.id, leadId, user.role); }
  catch { return NextResponse.json({ error: "forbidden" }, { status: 403 }); }

  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; }
  catch { return NextResponse.json({ error: "invalid_body" }, { status: 400 }); }

  const category    = body.category as PlanCategory | undefined;
  const ritmoId     = body.ritmoId as RitmoId | undefined;
  const goalId      = body.goalId as GoalId | undefined;
  const kidsPayment = body.kidsPayment as "single" | "flexible" | undefined;
  const nivel       = typeof body.nivel === "string" ? body.nivel.trim() : "";

  if (!category) return NextResponse.json({ error: "missing_category" }, { status: 400 });

  let meta: string;
  let ritmo: string | null = null;
  let tipo_pago: "suscripcion" | "unico";
  let clases_totales: number;
  let clases_por_mes: number | null = null;
  let importe_cents: number;
  let monthlyPriceCents: number | null = null;
  let packLabel: string | undefined;
  let packId: string;
  let paymentType: PaymentType;
  let productName: string;

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
    packId = ritmoId;
    paymentType = "flexible";
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
    packId = goalId;
    paymentType = "single";
  } else if (category === "kids") {
    meta = "kids";
    tipo_pago = "unico";
    clases_totales = KIDS_PACK.classes;
    importe_cents = KIDS_PACK.priceCents;
    packLabel = "Pack Kids";
    productName = "Pack Kids — Alemán para niños";
    packId = "kids";
    paymentType = kidsPayment === "flexible" ? "flexible" : "single";
  } else {
    return NextResponse.json({ error: "invalid_category" }, { status: 400 });
  }

  const sb = supabaseAdmin();

  const { data: teacherRow } = await sb
    .from("teachers")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!teacherRow) return NextResponse.json({ error: "teacher_not_found" }, { status: 404 });
  const teacherId = (teacherRow as { id: string }).id;

  const { data: leadRow } = await sb
    .from("leads")
    .select("email, name")
    .eq("id", leadId)
    .maybeSingle();
  const leadEmail = (leadRow as { email: string | null } | null)?.email;
  const leadName = (leadRow as { name: string | null } | null)?.name;

  const { data: oferta, error: insertErr } = await sb
    .from("ofertas_enviadas")
    .insert({
      lead_id: leadId,
      teacher_id: teacherId,
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
    console.error("[send-offer] insert failed:", insertErr);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }

  const ofertaId = (oferta as { id: string }).id;

  // Create Stripe Checkout Session with enrollment metadata
  let checkoutUrl: string;
  try {
    const stripe = stripeUS();
    const enrollmentMeta: Record<string, string> = {
      type: "enrollment",
      oferta_id: ofertaId,
      lead_id: leadId,
      teacher_id: teacherId,
    };

    let customerId: string | undefined;
    if (leadEmail) {
      try {
        customerId = await findOrCreateCustomer("us", {
          email: leadEmail,
          name: leadName ?? undefined,
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
        ...(customerId ? { customer: customerId } : { customer_email: leadEmail ?? undefined }),
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
        ...(customerId ? { customer: customerId } : { customer_email: leadEmail ?? undefined }),
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

    const session = await stripe.checkout.sessions.create(sessionParams);
    checkoutUrl = session.url!;
    console.log("[send-offer] checkout session created:", session.id);
  } catch (err) {
    console.error("[send-offer] Stripe checkout creation failed:", err);
    return NextResponse.json({ error: "stripe_error" }, { status: 502 });
  }

  await sb.from("lead_timeline").insert({
    lead_id: leadId,
    type: "agent_note",
    author: "system",
    content: `📦 Oferta enviada: ${packLabel} · ${(importe_cents / 100).toLocaleString("es-ES")} € · ${clases_totales} clases${clases_por_mes ? ` (${clases_por_mes}/mes)` : ""}`,
    metadata: {
      kind: "offer_sent",
      oferta_id: ofertaId,
      teacher_id: teacherId,
      pack_id: packId,
      category,
    },
  });

  const attendedOpts: AttendedOptions = {
    packId: packId as AttendedOptions["packId"],
    paymentType,
    objective: "",
    ...(nivel ? { nivel } : {}),
    fullUrl: checkoutUrl,
    ...(packLabel ? { packLabel } : {}),
  };

  await markTrialAttendedAwaitingConversion(leadId, attendedOpts);

  return NextResponse.json({ ok: true, ofertaId, checkoutUrl });
}
