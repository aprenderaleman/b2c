/**
 * Import Google Ads report CSV into google_ads_daily table.
 * The CSV format from Google Ads is:
 *   Row 1: title
 *   Row 2: date range
 *   Row 3: headers (Campaña, Conversiones, Código de moneda, Costo)
 *   Row 4+: data rows
 *
 * Since the report is aggregated (not daily), we distribute evenly across the date range.
 * Usage: node scripts/import_google_ads_csv.mjs <path-to-csv>
 */
import { createRequire } from "module";
import { readFileSync } from "fs";
const require = createRequire(new URL("../web/package.json", import.meta.url));
const { createClient } = require("@supabase/supabase-js");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars (or source web/.env.local)");
  process.exit(1);
}
const sb = createClient(url, key);

const csvPath = process.argv[2];
if (!csvPath) {
  console.error("Usage: node scripts/import_google_ads_csv.mjs <path-to-csv>");
  process.exit(1);
}

const raw = readFileSync(csvPath, "utf-8");
const lines = raw.trim().split("\n");

// Parse date range from line 2: "2 de marzo de 2026 - 14 de junio de 2026"
const dateRangeLine = lines[1].trim();
const monthMap = {
  enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5,
  julio: 6, agosto: 7, septiembre: 8, octubre: 9, noviembre: 10, diciembre: 11,
};

function parseSpanishDate(str) {
  const m = str.trim().match(/(\d+)\s+de\s+(\w+)\s+de\s+(\d{4})/);
  if (!m) throw new Error(`Cannot parse date: "${str}"`);
  return new Date(Date.UTC(+m[3], monthMap[m[2].toLowerCase()], +m[1]));
}

const [startStr, endStr] = dateRangeLine.split(" - ");
const startDate = parseSpanishDate(startStr);
const endDate = parseSpanishDate(endStr);
const totalDays = Math.round((endDate - startDate) / 86_400_000) + 1;

console.log(`Periodo: ${startDate.toISOString().slice(0, 10)} → ${endDate.toISOString().slice(0, 10)} (${totalDays} días)`);

// Parse data rows (skip header rows 0-2)
const campaigns = [];
for (let i = 3; i < lines.length; i++) {
  const line = lines[i].trim();
  if (!line) continue;
  const parts = line.split(",");
  if (parts.length < 4) continue;
  const name = parts[0].trim();
  const conversions = parseFloat(parts[1]);
  const currency = parts[2].trim();
  const cost = parseFloat(parts[3]);
  if (isNaN(conversions) && isNaN(cost)) continue;
  campaigns.push({ name, conversions, currency, cost_cents: Math.round(cost * 100) });
}

console.log(`\nCampañas encontradas: ${campaigns.length}`);
for (const c of campaigns) {
  console.log(`  ${c.name}: ${c.conversions} conv, €${(c.cost_cents / 100).toFixed(2)}`);
}

// Distribute evenly across days and upsert
const rows = [];
for (const c of campaigns) {
  const dailyConversions = c.conversions / totalDays;
  const dailyCostMicros = Math.round((c.cost_cents / 100) * 1_000_000 / totalDays);

  for (let d = 0; d < totalDays; d++) {
    const date = new Date(startDate.getTime() + d * 86_400_000);
    rows.push({
      date: date.toISOString().slice(0, 10),
      account_id: "b2c-deutsch",
      campaign_id: c.name.toLowerCase().replace(/\s+/g, "-"),
      campaign_name: c.name,
      impressions: 0,
      clicks: 0,
      cost_micros: dailyCostMicros,
      conversions: parseFloat(dailyConversions.toFixed(4)),
      currency: c.currency || "EUR",
    });
  }
}

console.log(`\nInsertando ${rows.length} filas (${campaigns.length} campañas × ${totalDays} días)...`);

// Upsert in batches of 500
const BATCH = 500;
let inserted = 0;
for (let i = 0; i < rows.length; i += BATCH) {
  const batch = rows.slice(i, i + BATCH);
  const { error } = await sb
    .from("google_ads_daily")
    .upsert(batch, { onConflict: "date,account_id,campaign_id" });
  if (error) {
    console.error(`Error en batch ${i}: ${error.message}`);
  } else {
    inserted += batch.length;
  }
}

console.log(`✓ ${inserted} filas insertadas/actualizadas`);

// Verify totals
const { data: verify } = await sb
  .from("google_ads_daily")
  .select("campaign_name, cost_micros, conversions");

const totals = {};
for (const r of (verify || [])) {
  const name = r.campaign_name || "?";
  if (!totals[name]) totals[name] = { cost: 0, conv: 0 };
  totals[name].cost += Number(r.cost_micros);
  totals[name].conv += Number(r.conversions);
}

console.log("\n=== Verificación en BD ===");
let totalConv = 0;
let totalCost = 0;
for (const [name, t] of Object.entries(totals)) {
  console.log(`  ${name}: ${t.conv.toFixed(1)} conv, €${(t.cost / 1_000_000).toFixed(2)}`);
  totalConv += t.conv;
  totalCost += t.cost;
}
console.log(`  TOTAL: ${totalConv.toFixed(0)} conversiones, €${(totalCost / 1_000_000).toFixed(2)} gasto`);
