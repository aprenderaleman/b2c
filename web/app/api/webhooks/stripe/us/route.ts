import { NextResponse } from "next/server";
import { constructEvent } from "@/lib/stripe";
import { processStripeEvent } from "../_shared";

export const runtime = "nodejs";
// La conversión automática (emails + WhatsApp + comisiones) puede
// superar el límite por defecto → Stripe veía timeout y reintentaba
// sin éxito (caso Nancy 2026-08-05).
export const maxDuration = 60;

export async function POST(req: Request) {
  const body = await req.text();
  const sig = req.headers.get("stripe-signature");
  if (!sig) return NextResponse.json({ error: "missing signature" }, { status: 400 });

  let event;
  try {
    event = constructEvent(body, sig, "us");
  } catch (err) {
    console.error("Stripe US webhook signature verification failed:", (err as Error).message);
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  await processStripeEvent(event, "us");
  return NextResponse.json({ received: true });
}
