import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { createClient } = require("../web/node_modules/@supabase/supabase-js");
import { readFileSync } from "fs";

const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_KEY) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY en el entorno (ver web/.env.local)");
const sb = createClient("https://mtemnkmxajaluocfekbx.supabase.co", SUPABASE_KEY);

// Read the daily CSV
const text = readFileSync("C:\\Users\\gelfi\\Downloads\\Informe sin título.csv", "utf-8");
const lines = text.split(/\r?\n/).filter(l => l.trim());

// Skip metadata rows (line 0: title, line 1: date range), header is line 2
// Día,Conversiones,Código de moneda,Costo
const dataLines = lines.slice(3);

let inserted = 0;
let errors = 0;

for (const line of dataLines) {
  const parts = line.split(",");
  if (parts.length < 4) continue;

  const date = parts[0].trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;

  const conversions = parseFloat(parts[1]) || 0;
  const currency = parts[2].trim();
  const cost = parseFloat(parts[3]) || 0;
  const costMicros = Math.round(cost * 1_000_000);

  const { error } = await sb
    .from("google_ads_daily")
    .upsert(
      {
        date,
        account_id: "csv_import",
        campaign_id: "all",
        campaign_name: "all",
        impressions: 0,
        clicks: 0,
        cost_micros: costMicros,
        conversions,
        currency: currency || "EUR",
        fetched_at: new Date().toISOString(),
      },
      { onConflict: "date,account_id,campaign_id" }
    )
    .select("id");

  if (error) {
    console.error(`Error ${date}: ${error.message}`);
    errors++;
  } else {
    inserted++;
  }
}

console.log(`Done: ${inserted} inserted, ${errors} errors`);

// Now import the campaign-level aggregate as well (separate campaign_ids)
const text2 = readFileSync("C:\\Users\\gelfi\\Downloads\\Informe sin título (1).csv", "utf-8");
const lines2 = text2.split(/\r?\n/).filter(l => l.trim());
// Header: Campaña,Conversiones,Código de moneda,Costo
const dataLines2 = lines2.slice(3);

for (const line of dataLines2) {
  const parts = line.split(",");
  if (parts.length < 4) continue;
  const campaign = parts[0].trim();
  if (!campaign) continue;
  const conversions = parseFloat(parts[1]) || 0;
  const cost = parseFloat(parts[3]) || 0;
  const costMicros = Math.round(cost * 1_000_000);
  const campaignId = campaign.toLowerCase().replace(/\s+/g, "_");

  // We already have daily data — skip the aggregate to avoid double-counting
  console.log(`Campaign aggregate: ${campaign} = ${cost} EUR, ${conversions} conv (skipping, daily data already imported)`);
}

console.log("All done.");
