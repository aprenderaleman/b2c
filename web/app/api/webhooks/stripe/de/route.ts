import { NextResponse } from "next/server";
import { constructEvent } from "@/lib/stripe";
import { processStripeEvent } from "../_shared";

export const runtime = "nodejs";
// Igual que /us: la conversión automática puede superar el límite por
// defecto → timeouts → Stripe reintenta sin éxito.
export const maxDuration = 60;

export async function POST(req: Request) {
  const body = await req.text();
  const sig = req.headers.get("stripe-signature");
  if (!sig) return NextResponse.json({ error: "missing signature" }, { status: 400 });

  let event;
  try {
    event = constructEvent(body, sig, "de");
  } catch (err) {
    console.error("Stripe DE webhook signature verification failed:", (err as Error).message);
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  await processStripeEvent(event, "de");
  return NextResponse.json({ received: true });
}
