import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { fetchDailyReport } from "@/lib/google-ads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handleSync(req);
}

export async function POST(req: Request) {
  return handleSync(req);
}

async function handleSync(req: Request): Promise<Response> {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization") ?? req.headers.get("x-cron-secret");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;
  if (!customerId) {
    return NextResponse.json({ error: "Google Ads not configured" }, { status: 200 });
  }

  const sb = supabaseAdmin();
  const LOOKBACK_DAYS = 7;
  const dates: string[] = [];
  for (let i = 1; i <= LOOKBACK_DAYS; i++) {
    dates.push(new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10));
  }

  let totalUpserted = 0;
  const errors: string[] = [];

  for (const date of dates) {
    try {
      const metrics = await fetchDailyReport(date);

      for (const m of metrics) {
        const { error } = await sb.from("google_ads_daily").upsert(
          {
            date: m.date,
            account_id: customerId.replace(/-/g, ""),
            campaign_id: m.campaign_id,
            campaign_name: m.campaign_name,
            impressions: m.impressions,
            clicks: m.clicks,
            cost_micros: m.cost_micros,
            conversions: m.conversions,
            currency: "EUR",
          },
          { onConflict: "date,account_id,campaign_id" },
        );
        if (!error) totalUpserted++;
      }
    } catch (err) {
      errors.push(`${date}: ${(err as Error).message}`);
    }
  }

  if (errors.length === LOOKBACK_DAYS) {
    console.error("Google Ads sync: all days failed", errors[0]);
    return NextResponse.json({
      ok: false,
      error: errors[0],
      dates,
    }, { status: 200 });
  }

  return NextResponse.json({
    ok: true,
    dates,
    upserted: totalUpserted,
    errors: errors.length > 0 ? errors : undefined,
  });
}
