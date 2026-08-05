import { NextResponse } from "next/server";
import { createEnrollmentCheckoutSession } from "@/lib/enrollment-checkout";

/**
 * GET /pago/[ofertaId]
 *
 * Link corto de pago que se comparte con el lead por WhatsApp/email.
 * Al visitarlo se crea una Checkout Session fresca y se redirige a
 * Stripe. Así:
 *   - El lead ve un link limpio (b2c.aprender-aleman.de/pago/xxx) en
 *     vez de la URL de 500+ chars de checkout.stripe.com.
 *   - El link nunca caduca (las sessions de Stripe caducan a las 24h;
 *     aquí se genera una nueva en cada visita).
 *   - Si la oferta ya se pagó, redirige a la página de éxito.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://b2c.aprender-aleman.de").replace(/\/$/, "");

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ ofertaId: string }> },
) {
  const { ofertaId } = await params;

  if (!/^[0-9a-f-]{36}$/.test(ofertaId)) {
    return NextResponse.redirect(`${SITE_URL}/`, 302);
  }

  const result = await createEnrollmentCheckoutSession(ofertaId);

  if (result.ok) {
    return NextResponse.redirect(result.url, 302);
  }
  if (result.reason === "already_accepted") {
    return NextResponse.redirect(`${SITE_URL}/inscripcion-exitosa?oferta=${ofertaId}`, 302);
  }
  // not_found / stripe_error → home (el closer puede regenerar la oferta)
  return NextResponse.redirect(`${SITE_URL}/`, 302);
}
