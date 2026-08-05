import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getStripeClient } from "@/lib/stripe";
import { processStripeEvent } from "../../webhooks/stripe/_shared";

/**
 * GET/POST /api/cron/stripe-reconcile — cada 5 min.
 *
 * Red de seguridad pull-based para los webhooks de Stripe. Caso real
 * Nancy 2026-08-05: pagó 320€, el checkout.session.completed nunca
 * llegó al webhook (Stripe lo reintentó durante horas sin éxito) y la
 * conversión automática no corrió — hubo que convertirla a mano.
 *
 * Lógica:
 *   1. Para cada cuenta (us/de): lista los eventos de los últimos
 *      60 min de los tipos que procesamos.
 *   2. Los que NO están en stripe_events → processStripeEvent()
 *      (misma ruta de código que el webhook, misma idempotencia).
 *
 * Con esto los webhooks pasan a ser "best effort": si llegan, genial
 * (latencia segundos); si no, este cron los recoge en ≤5 min.
 *
 * Auth: Bearer CRON_SECRET o X-Cron-Secret.
 */
export const runtime  = "nodejs";
export const dynamic  = "force-dynamic";
export const maxDuration = 300;

const EVENT_TYPES = [
  "checkout.session.completed",
  "payment_intent.succeeded",
  "invoice.paid",
  "invoice.payment_succeeded",
  "customer.subscription.updated",
  "customer.subscription.deleted",
];

const LOOKBACK_SECONDS = 60 * 60;   // 1h — cubre de sobra el ciclo de 5 min

function authorised(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const bearer = req.headers.get("authorization");
  if (bearer && bearer.toLowerCase().startsWith("bearer ") && bearer.slice(7).trim() === expected) return true;
  return req.headers.get("x-cron-secret") === expected;
}

export async function GET(req: Request)  { return run(req); }
export async function POST(req: Request) { return run(req); }

async function run(req: Request) {
  if (!authorised(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const sb = supabaseAdmin();
  const results: Record<string, { checked: number; recovered: number; errors: number }> = {};

  for (const account of ["us", "de"] as const) {
    const key = account === "us" ? process.env.STRIPE_SECRET_KEY_US : process.env.STRIPE_SECRET_KEY_DE;
    if (!key) continue;
    results[account] = { checked: 0, recovered: 0, errors: 0 };

    let stripe;
    try { stripe = getStripeClient(account); }
    catch { continue; }

    const since = Math.floor(Date.now() / 1000) - LOOKBACK_SECONDS;

    for (const type of EVENT_TYPES) {
      try {
        // Paginación defensiva: 100 por tipo por ciclo es más que
        // suficiente para el volumen real de la academia.
        const list = await stripe.events.list({
          type,
          created: { gte: since },
          limit: 100,
        });

        for (const event of list.data) {
          results[account].checked++;

          const { data: existing } = await sb
            .from("stripe_events")
            .select("event_id")
            .eq("event_id", event.id)
            .maybeSingle();
          if (existing) continue;

          try {
            console.log(`[stripe-reconcile] recovering missed event ${event.id} (${event.type}, ${account})`);
            await processStripeEvent(event, account);
            results[account].recovered++;
          } catch (err) {
            results[account].errors++;
            console.error(`[stripe-reconcile] processing ${event.id} failed:`, err);
          }
        }
      } catch (err) {
        results[account].errors++;
        console.error(`[stripe-reconcile] listing ${type} (${account}) failed:`, err);
      }
    }
  }

  return NextResponse.json({ ok: true, results });
}
