import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getStripeClient } from "@/lib/stripe";
import { getExchangeRate, convertToEur } from "@/lib/exchange-rates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization") ?? req.headers.get("x-cron-secret");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const results = { us: 0, de: 0, skipped: 0, errors: 0 };

  for (const account of ["us", "de"] as const) {
    try {
      const key = account === "us" ? process.env.STRIPE_SECRET_KEY_US : process.env.STRIPE_SECRET_KEY_DE;
      if (!key) {
        console.log(`Skipping Stripe ${account}: no API key`);
        continue;
      }

      const stripe = getStripeClient(account);
      const imported = await backfillAccount(stripe, account);
      results[account] = imported.inserted;
      results.skipped += imported.skipped;
    } catch (err) {
      console.error(`Stripe ${account} backfill error:`, (err as Error).message);
      results.errors++;
    }
  }

  return NextResponse.json({ ok: true, results });
}

async function backfillAccount(
  stripe: ReturnType<typeof getStripeClient>,
  account: "us" | "de",
): Promise<{ inserted: number; skipped: number }> {
  const sb = supabaseAdmin();
  let inserted = 0;
  let skipped = 0;
  let hasMore = true;
  let startingAfter: string | undefined;

  while (hasMore) {
    const params: Record<string, unknown> = {
      limit: 100,
      expand: ["data.latest_charge"],
    };
    if (startingAfter) params.starting_after = startingAfter;

    const list = await stripe.paymentIntents.list(params as Parameters<typeof stripe.paymentIntents.list>[0]);

    for (const pi of list.data) {
      if (pi.status !== "succeeded") { skipped++; continue; }
      // Check if already imported
      const { data: existing } = await sb
        .from("payments")
        .select("id")
        .eq("stripe_payment_intent_id", pi.id)
        .maybeSingle();
      if (existing) {
        skipped++;
        continue;
      }

      const currency = (pi.currency ?? "eur").toUpperCase();
      const email = pi.receipt_email
        ?? (typeof pi.customer === "string" ? null : null);
      if (!email || pi.amount === 0) {
        skipped++;
        continue;
      }

      const { data: student } = await sb
        .from("students")
        .select("id, users!inner(email)")
        .eq("users.email", email)
        .maybeSingle();
      if (!student) {
        skipped++;
        continue;
      }

      const rate = await getExchangeRate(currency, "EUR");
      const eurCents = convertToEur(pi.amount, currency, rate);
      const latestCharge = pi.latest_charge;
      const chargeId = typeof latestCharge === "string"
        ? latestCharge
        : (latestCharge as { id: string } | null)?.id ?? null;

      await sb.from("payments").insert({
        student_id: (student as { id: string }).id,
        amount_cents: eurCents,
        currency: "EUR",
        type: "package",
        status: "paid",
        paid_at: new Date(pi.created * 1000).toISOString(),
        stripe_payment_intent_id: pi.id,
        stripe_account: account,
        original_currency: currency,
        original_amount_cents: pi.amount,
        exchange_rate: rate,
        stripe_charge_id: chargeId,
        note: `Backfill Stripe ${account.toUpperCase()}`,
      });
      inserted++;
    }

    hasMore = list.has_more;
    if (list.data.length > 0) {
      startingAfter = list.data[list.data.length - 1].id;
    }
  }

  return { inserted, skipped };
}
