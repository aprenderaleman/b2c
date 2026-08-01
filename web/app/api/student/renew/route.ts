import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { getStripeClient, findOrCreateCustomer } from "@/lib/stripe";

export const runtime = "nodejs";

const PLATFORM_URL = (process.env.PLATFORM_URL ?? "https://b2c.aprender-aleman.de").replace(/\/$/, "");

/**
 * POST /api/student/renew
 *
 * Creates a Stripe Checkout Session for the student to renew/advance their
 * next payment. If they have a stripe_customer_id, reuses it; otherwise
 * creates one. Returns the checkout URL for redirect.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const role = (session.user as { role?: string }).role;
  if (role !== "student" && role !== "admin" && role !== "superadmin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const sb = supabaseAdmin();
  const { data: student } = await sb
    .from("students")
    .select(`
      id, stripe_customer_id, oferta_id, classes_per_month,
      subscription_type, monthly_price_cents,
      users!inner(email, full_name)
    `)
    .eq("user_id", (session.user as { id: string }).id)
    .maybeSingle();

  if (!student) {
    return NextResponse.json({ error: "student_not_found" }, { status: 404 });
  }

  const s = student as {
    id: string; stripe_customer_id: string | null; oferta_id: string | null;
    classes_per_month: number | null; subscription_type: string;
    monthly_price_cents: number | null;
    users: { email: string; full_name: string | null } | Array<{ email: string; full_name: string | null }>;
  };

  const u = Array.isArray(s.users) ? s.users[0] : s.users;
  const email = u?.email ?? "";
  const name = u?.full_name ?? "Estudiante";

  // Resolve amount: monthly_price_cents or look up from oferta
  let amountCents = s.monthly_price_cents;
  if (!amountCents && s.oferta_id) {
    const { data: oferta } = await sb
      .from("ofertas_enviadas")
      .select("importe_cents, clases_totales, clases_por_mes")
      .eq("id", s.oferta_id)
      .maybeSingle();
    if (oferta) {
      const of = oferta as { importe_cents: number; clases_totales: number; clases_por_mes: number | null };
      if (of.clases_por_mes && of.clases_por_mes > 0) {
        const months = Math.ceil(of.clases_totales / of.clases_por_mes);
        amountCents = Math.round(of.importe_cents / months);
      } else {
        amountCents = of.importe_cents;
      }
    }
  }

  if (!amountCents || amountCents <= 0) {
    return NextResponse.json(
      { error: "no_price", message: "No se puede determinar el importe. Contacta al equipo." },
      { status: 400 },
    );
  }

  const stripe = getStripeClient("us");

  const customerId = s.stripe_customer_id
    ?? await findOrCreateCustomer("us", { email, name, metadata: { student_id: s.id } });

  if (!s.stripe_customer_id) {
    await sb.from("students").update({ stripe_customer_id: customerId }).eq("id", s.id);
  }

  const checkoutSession = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: "payment",
    line_items: [{
      price_data: {
        currency: "eur",
        product_data: {
          name: `Cuota mensual — ${s.classes_per_month ?? "?"} clases`,
        },
        unit_amount: amountCents,
      },
      quantity: 1,
    }],
    metadata: {
      type: "renewal",
      student_id: s.id,
      oferta_id: s.oferta_id ?? "",
    },
    success_url: `${PLATFORM_URL}/estudiante?renewed=1`,
    cancel_url: `${PLATFORM_URL}/estudiante`,
  });

  return NextResponse.json({ ok: true, url: checkoutSession.url });
}
