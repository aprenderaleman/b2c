import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getStripeClient } from "@/lib/stripe";

/**
 * POST /api/admin/stripe/payment-link
 *
 * Crea un Payment Link de PAGO ÚNICO (reutilizable) por un importe a
 * medida, para extras fuera del plan del alumno (caso Saidys, Gelfis
 * 2026-11-13: pack de 4 clases de conversación a 80 €).
 *
 * A propósito NO es una suscripción: el webhook trata toda factura de
 * suscripción como renovación del plan principal (desbloqueo mensual +
 * comisión al profe del trial) y el borrado de una suscripción marca el
 * plan como cancelado. Un pago único solo deja la fila en `payments`
 * (rama genérica de checkout.session.completed); las clases del extra se
 * suman a mano (classes_adjustment + clases_desbloqueadas).
 *
 * `studentId` viaja en la metadata del link (→ checkout session) y del
 * payment intent, así el webhook asigna el pago aunque pague con otro email.
 *
 * Auth: admin/superadmin o Bearer CRON_SECRET (las claves de Stripe solo
 * viven en Vercel).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  account:     z.enum(["us", "de"]).default("us"),
  name:        z.string().trim().min(3).max(120),
  amountCents: z.number().int().min(500).max(500_000),
  studentId:   z.string().uuid().optional(),
  kind:        z.string().trim().min(1).max(40).default("extra"),
  confirmationMessage: z.string().trim().max(400).optional(),
});

async function authorised(req: Request): Promise<boolean> {
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (process.env.CRON_SECRET && bearer === process.env.CRON_SECRET) return true;
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  return role === "admin" || role === "superadmin";
}

export async function POST(req: Request) {
  if (!(await authorised(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "bad_request", issues: parsed.error.issues }, { status: 400 });
  const b = parsed.data;

  const stripe = getStripeClient(b.account);
  const metadata: Record<string, string> = { type: "extra_pack", kind: b.kind };
  if (b.studentId) metadata.student_id = b.studentId;

  try {
    const price = await stripe.prices.create({
      currency: "eur",
      unit_amount: b.amountCents,
      product_data: { name: b.name, metadata },
      metadata,
    });
    const link = await stripe.paymentLinks.create({
      line_items: [{ price: price.id, quantity: 1 }],
      metadata,
      payment_intent_data: { metadata },
      ...(b.confirmationMessage
        ? { after_completion: { type: "hosted_confirmation" as const, hosted_confirmation: { custom_message: b.confirmationMessage } } }
        : {}),
    });
    return NextResponse.json({ ok: true, url: link.url, paymentLinkId: link.id, priceId: price.id, amountCents: b.amountCents });
  } catch (e) {
    console.error("[admin/stripe/payment-link] failed:", e);
    return NextResponse.json({ error: "stripe_failed", message: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
