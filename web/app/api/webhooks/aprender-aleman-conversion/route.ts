import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase";
import { handleExternalConversion } from "@/lib/external-conversion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function verifySignature(body: string, signature: string, secret: string): boolean {
  const expected = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
  if (expected.length !== signature.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

export async function POST(req: NextRequest) {
  const secret = process.env.B2C_NOTIFY_SECRET;
  if (!secret) {
    console.error("[aa-conversion-webhook] B2C_NOTIFY_SECRET not configured");
    return NextResponse.json({ error: "not_configured" }, { status: 500 });
  }

  const signature = req.headers.get("x-notify-signature");
  if (!signature) {
    return NextResponse.json({ error: "missing_signature" }, { status: 401 });
  }

  const rawBody = await req.text();

  if (!verifySignature(rawBody, signature, secret)) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const p = payload as {
    event?: string;
    lead_id?: string;
    stripe?: {
      checkout_session_id?: string;
      subscription_id?: string | null;
      customer_id?: string;
      payment_intent_id?: string | null;
      mode?: string;
    };
    offer?: {
      goal_id?: string;
      rhythm_id?: string | null;
      max_invoices?: number | null;
      total_classes?: number;
      classes_per_month?: number;
    };
    amount?: {
      currency?: string;
      total_cents?: number;
    };
    customer?: {
      email?: string;
      name?: string;
      phone?: string;
      country?: string;
    };
    source?: string;
  };

  if (p.event !== "checkout_completed") {
    return NextResponse.json({ ok: true, skipped: true });
  }

  if (!p.lead_id || !p.stripe?.checkout_session_id) {
    return NextResponse.json({ error: "missing_lead_id_or_session" }, { status: 400 });
  }

  const sb = supabaseAdmin();
  const { data: dup } = await sb
    .from("stripe_events")
    .select("event_id")
    .eq("event_id", `aa_${p.stripe.checkout_session_id}`)
    .maybeSingle();
  if (dup) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  await sb.from("stripe_events").insert({
    event_id: `aa_${p.stripe.checkout_session_id}`,
    event_type: "aa_checkout_completed",
    account_tag: "aa_web",
  });

  try {
    await handleExternalConversion({
      leadId:              p.lead_id,
      checkoutSessionId:   p.stripe.checkout_session_id,
      subscriptionId:      p.stripe.subscription_id ?? null,
      customerId:          p.stripe.customer_id ?? "",
      paymentIntentId:     p.stripe.payment_intent_id ?? null,
      mode:                (p.stripe.mode as "subscription" | "payment") ?? "subscription",
      goalId:              p.offer?.goal_id ?? null,
      rhythmId:            p.offer?.rhythm_id ?? null,
      maxInvoices:         p.offer?.max_invoices ?? null,
      totalClasses:        p.offer?.total_classes ?? 0,
      classesPerMonth:     p.offer?.classes_per_month ?? 0,
      amountCents:         p.amount?.total_cents ?? 0,
      currency:            p.amount?.currency ?? "EUR",
      customerEmail:       p.customer?.email ?? null,
      customerName:        p.customer?.name ?? null,
      customerPhone:       p.customer?.phone ?? null,
      customerCountry:     p.customer?.country ?? null,
      source:              p.source ?? "aprender-aleman.de",
    });
  } catch (err) {
    // Liberar la clave de idempotencia: si no lo hacemos, el retry del
    // emisor (1x tras 500ms) chocaría con el dedup y devolvería
    // duplicate:true sin haber convertido nunca.
    await sb.from("stripe_events").delete()
      .eq("event_id", `aa_${p.stripe.checkout_session_id}`);

    if (err instanceof Error && err.message === "lead_not_found") {
      // 404 distingue "lead inexistente" (dato malo, no reintentar) de un
      // fallo real del servidor (500, sí reintentar) en los logs de ambos lados.
      return NextResponse.json({ error: "lead_not_found" }, { status: 404 });
    }
    console.error("[aa-conversion-webhook] handleExternalConversion failed:", err);
    return NextResponse.json({ error: "conversion_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
