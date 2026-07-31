import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase";
import { stripeUS } from "@/lib/stripe";
import { buildTrialToken } from "@/lib/trial-token";

/**
 * POST /api/public/book-trial-metaads-paid
 *
 * Endpoint dedicado al funnel /meta-ads-paid (Gelfis 2026-07-28). Es
 * un wrapper del /api/public/book-trial existente que además:
 *
 *  - Persiste las 5 respuestas del wizard en leads.qualification_answers.
 *  - Marca leads.priority_deadline (para el 🔥 en el CRM).
 *  - Marca leads.landing_intent='meta-ads-paid' y source específico.
 *  - Marca leads.deposit_intent_at=NOW (flag "inició paid sin depósito").
 *  - Retrasa el envío de la confirmación WA/email 13 min
 *    (classes.notify_after_at) para no interrumpir el pago.
 *  - Crea una Stripe Checkout Session (US, price env
 *    STRIPE_DEPOSIT_PRICE_ID_US o inline 10€) con metadata
 *    type='trial_deposit_metaads' → el webhook flipea reserva_prioritaria.
 *
 * Retorna { ok, classId, leadId, stripeUrl } — el cliente redirige a
 * stripeUrl. Si Stripe falla, retorna confirmacionUrl para no dejar
 * al lead colgado sin destino.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://b2c.aprender-aleman.de").replace(/\/$/, "");
const NOTIFY_DELAY_MIN = 13; // 12-15 min per spec

const Body = z.object({
  name:          z.string().trim().min(2).max(100),
  email:         z.string().trim().toLowerCase().email(),
  whatsapp_e164: z.string().trim().min(8).nullable().optional(),
  german_level:  z.enum(["A0","A1","A2","B1","B2","C1","C2"]).nullable().optional(),
  slot_iso:      z.string().datetime(),
  teacher_id:    z.string().uuid(),
  qualification: z.object({
    goal:     z.enum(["job","ausbildung","citizenship","daily_life","moving"]),
    level:    z.enum(["zero","basic","intermediate","advanced","unknown"]),
    deadline: z.enum(["concrete","6m","year","no_rush"]),
  }),
  gclid:         z.string().trim().max(200).nullable().optional(),
  gbraid:        z.string().trim().max(200).nullable().optional(),
  wbraid:        z.string().trim().max(200).nullable().optional(),
  fbclid:        z.string().trim().max(500).nullable().optional(),
  utm_source:    z.string().trim().max(120).nullable().optional(),
  utm_medium:    z.string().trim().max(120).nullable().optional(),
  utm_campaign:  z.string().trim().max(200).nullable().optional(),
  utm_term:      z.string().trim().max(200).nullable().optional(),
  utm_content:   z.string().trim().max(200).nullable().optional(),
});

export async function POST(req: Request) {
  try {
    return await handle(req);
  } catch (err) {
    const e = err as { message?: string; stack?: string };
    console.error("[book-trial-metaads-paid] UNHANDLED:", { message: e.message, stack: e.stack?.split("\n").slice(0,4).join(" | ") });
    return NextResponse.json({ ok: false, error: "server_error", detail: e.message ?? "unknown" }, { status: 502 });
  }
}

async function handle(req: Request) {
  let raw: unknown;
  try { raw = await req.json(); }
  catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }

  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed", details: parsed.error.flatten() }, { status: 400 });
  }
  const b = parsed.data;

  // Forward al book-trial existente — reusa TODA la lógica (rate limit,
  // slot check, teacher validation, upsert lead, insert class, Zoom
  // link, timeline). El IP del cliente se propaga para que el rate
  // limit cuente contra el lead real.
  const clientIp = req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? "unknown";

  const forwardBody = {
    name: b.name,
    email: b.email,
    whatsapp_e164: b.whatsapp_e164 ?? null,
    german_level: b.german_level ?? null,
    goal: qualGoalToDbGoal(b.qualification.goal),
    slot_iso: b.slot_iso,
    teacher_id: b.teacher_id,
    landing_intent: "meta-ads-paid",
    motivo_inicial: "particulares" as const,
    gclid: b.gclid ?? null,
    gbraid: b.gbraid ?? null,
    wbraid: b.wbraid ?? null,
    utm_source: b.utm_source ?? null,
    utm_medium: b.utm_medium ?? null,
    utm_campaign: b.utm_campaign ?? null,
    utm_term: b.utm_term ?? null,
    utm_content: b.utm_content ?? null,
  };

  const bookRes = await fetch(`${SITE_URL}/api/public/book-trial`, {
    method: "POST",
    headers: {
      "Content-Type":    "application/json",
      "x-forwarded-for": clientIp,
    },
    body: JSON.stringify(forwardBody),
  });
  const bookJson = await bookRes.json().catch(() => ({}));
  if (!bookRes.ok || !bookJson.classId || !bookJson.leadId) {
    return NextResponse.json({
      ok: false,
      error: bookJson.error ?? "book_failed",
      detail: bookJson.message ?? bookJson.detail ?? `book-trial returned ${bookRes.status}`,
    }, { status: bookRes.status || 502 });
  }
  const classId: string = bookJson.classId;
  const leadId:  string = bookJson.leadId;
  const trialToken: string | undefined = bookJson.token;

  const sb = supabaseAdmin();

  // Patch del lead con qualification + fbclid + priority_deadline +
  // deposit_intent_at + source específico. NO tocamos status ni
  // trial_scheduled_at (book-trial ya los setó correctamente).
  await sb.from("leads").update({
    qualification_answers: b.qualification,
    priority_deadline:     b.qualification.deadline,
    deposit_intent_at:     new Date().toISOString(),
    source:                "meta_ads_paid_funnel",
    fbclid:                b.fbclid ?? null,
  }).eq("id", leadId);

  // Retrasar la primera notificación WA/email 13 min → deja al lead
  // completar Stripe sin duplicar mensajes. El cron
  // send-trial-notifications ya respeta notify_after_at.
  const notifyAfter = new Date(Date.now() + NOTIFY_DELAY_MIN * 60_000).toISOString();
  await sb.from("classes").update({ notify_after_at: notifyAfter }).eq("id", classId);

  // Timeline audit.
  await sb.from("lead_timeline").insert({
    lead_id: leadId,
    type:    "agent_note",
    author:  "system",
    content: `📋 Meta Ads Paid wizard completado. Meta: ${b.qualification.goal} · Nivel: ${b.qualification.level} · Plazo: ${b.qualification.deadline}. Notificaciones (email + WA) programadas para +${NOTIFY_DELAY_MIN} min (esperando pago Stripe).`,
    metadata: { kind: "meta_ads_paid_qualified", qualification: b.qualification, notify_delay_min: NOTIFY_DELAY_MIN },
  });

  // Confirmacion URL para fallback (si Stripe cae, al menos el lead
  // ve su reserva y luego podría reintentar el pago).
  const token = trialToken ?? buildTrialToken(leadId, classId);
  const confirmacionUrl = `${SITE_URL}/confirmacion?c=${classId}&t=${encodeURIComponent(token)}`;

  // Stripe Checkout Session — reusa el price ID existente (Gelfis
  // confirmó 2026-07-28 usar el mismo). metadata.type diferenciado:
  // 'trial_deposit_metaads' → el webhook _shared.ts flipea
  // reserva_prioritaria igual que el flow deposit-checkout.
  const stripe = stripeUS();
  const priceId = process.env.STRIPE_DEPOSIT_PRICE_ID_US;
  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = priceId
    ? [{ price: priceId, quantity: 1 }]
    : [{
        quantity: 1,
        price_data: {
          currency: "eur",
          unit_amount: 1000,
          product_data: {
            name: "Agenda Prioritaria — Clase de prueba (Meta Ads)",
            description: "Reserva tu plaza con prioridad. Se descuentan íntegros del programa.",
          },
        },
      }];

  let stripeUrl: string | undefined;
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: b.email,
      line_items: lineItems,
      success_url: `${confirmacionUrl}&deposito=ok`,
      cancel_url:  confirmacionUrl,
      metadata: {
        type:               "trial_deposit_metaads",
        lead_id:            leadId,
        class_id:           classId,
        attribution_source: "meta-ads-paid",
      },
      payment_intent_data: {
        metadata: {
          type:               "trial_deposit_metaads",
          lead_id:            leadId,
          class_id:           classId,
          attribution_source: "meta-ads-paid",
        },
      },
    });
    stripeUrl = session.url ?? undefined;
  } catch (err) {
    const e = err as { message?: string; code?: string };
    console.error("[book-trial-metaads-paid] Stripe error:", { message: e.message, code: e.code });
    // No fallamos el request — la reserva quedó agendada. Devolvemos
    // confirmacionUrl y el frontend redirige ahí como fallback.
  }

  return NextResponse.json({
    ok: true,
    classId,
    leadId,
    stripeUrl:       stripeUrl ?? null,
    confirmacionUrl: stripeUrl ? null : confirmacionUrl,
  });
}

// Mapea el goal del wizard al ENUM `lead_goal` de la BD.
// Valores válidos (migration 001): work | visa | studies | exam |
// travel | already_in_dach. NO uses otros — el INSERT en leads
// falla con lead_create_failed si se pasa un valor fuera del enum.
function qualGoalToDbGoal(goal: string): string {
  switch (goal) {
    case "job":         return "work";
    case "ausbildung":  return "studies";
    case "citizenship": return "visa";
    case "daily_life":  return "already_in_dach";
    case "moving":      return "travel";
    default:            return "work";
  }
}
