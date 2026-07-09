/**
 * Import Google Ads campaign report CSV into google_ads_daily table.
 *
 * Supports two CSV formats from Google Ads:
 *
 * 1) Monthly campaign report (preferred — real monthly data):
 *    Row 1: title ("Informe de campaña")
 *    Row 2: date range ("Todo el período" or "1 de enero de 2026 - 15 de junio de 2026")
 *    Row 3: headers (Mes, Estado de la campaña, Campaña, ..., Clics, Impr., CTR, Prom. CPC, Costo, ..., Conversiones, ...)
 *    Row 4+: monthly data per campaign + "Total: Cuenta" rows
 *
 * 2) Aggregated summary (legacy — distributes evenly):
 *    Row 1: title
 *    Row 2: date range
 *    Row 3: headers (Campaña, Conversiones, Código de moneda, Costo)
 *    Row 4+: one row per campaign (aggregated)
 *
 * Monthly data is distributed evenly across days within each month.
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

const monthMap = {
  enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5,
  julio: 6, agosto: 7, septiembre: 8, octubre: 9, noviembre: 10, diciembre: 11,
};

// ---------------------------------------------------------------------------
// CSV parsing helpers
// ---------------------------------------------------------------------------

function parseCsvLine(line) {
  const fields = [];
  let current = "";
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if (ch === "," && !inQuotes) { fields.push(current.trim()); current = ""; continue; }
    current += ch;
  }
  fields.push(current.trim());
  return fields;
}

function parseNum(s) {
  if (!s || s === "--" || s === " --") return 0;
  // CSV uses dot as decimal, comma as thousands (inside quotes)
  return parseFloat(s.replace(/,/g, "")) || 0;
}

function parseSpanishMonth(str) {
  const m = str.trim().match(/^(\w+)\s+de\s+(\d{4})$/);
  if (!m) return null;
  const monthIdx = monthMap[m[1].toLowerCase()];
  if (monthIdx === undefined) return null;
  return { year: +m[2], month: monthIdx };
}

function parseSpanishDate(str) {
  const m = str.trim().match(/(\d+)\s+de\s+(\w+)\s+de\s+(\d{4})/);
  if (!m) throw new Error(`Cannot parse date: "${str}"`);
  return new Date(Date.UTC(+m[3], monthMap[m[2].toLowerCase()], +m[1]));
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

// ---------------------------------------------------------------------------
// Detect format
// ---------------------------------------------------------------------------

const headerLine = lines[2]?.trim() || "";
const isMonthlyFormat = headerLine.startsWith("Mes,");

if (isMonthlyFormat) {
  await importMonthlyReport();
} else {
  await importAggregatedReport();
}

// ---------------------------------------------------------------------------
// Monthly campaign report import
// ---------------------------------------------------------------------------

async function importMonthlyReport() {
  console.log("Formato detectado: Informe mensual de campañas\n");

  const headers = parseCsvLine(lines[2]);
  const mesIdx = headers.indexOf("Mes");
  const campaignIdx = headers.indexOf("Campaña");
  const clicksIdx = headers.indexOf("Clics");
  const imprIdx = headers.indexOf("Impr.");
  const costoIdx = headers.indexOf("Costo");
  const convIdx = headers.indexOf("Conversiones");

  // Parse individual campaign rows and "Total: Cuenta" rows
  // "Total:" label is in column 1 (Estado de la campaña), not in Campaña column
  const estadoIdx = headers.indexOf("Estado de la campaña");
  const campaignData = [];  // {month, year, campaign, clicks, impressions, cost, conversions}
  const accountTotals = []; // {month, year, clicks, impressions, cost, conversions}

  for (let i = 3; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const fields = parseCsvLine(line);
    const mesStr = fields[mesIdx];
    if (!mesStr || mesStr === "--" || mesStr === " --") continue;

    const parsed = parseSpanishMonth(mesStr);
    if (!parsed) continue;

    const estado = fields[estadoIdx] || "";
    const clicks = parseNum(fields[clicksIdx]);
    const impressions = parseNum(fields[imprIdx]);
    const cost = parseNum(fields[costoIdx]);
    const conversions = parseNum(fields[convIdx]);

    if (estado.includes("Total: Cuenta")) {
      accountTotals.push({ ...parsed, clicks, impressions, cost, conversions });
    } else if (!estado.includes("Total:")) {
      const campaignName = fields[campaignIdx] || "";
      if (campaignName && campaignName !== "--" && campaignName !== " --") {
        campaignData.push({
          ...parsed, campaign: campaignName, clicks, impressions, cost, conversions,
        });
      }
    }
  }

  // Build a map of named campaign totals per month for "Otras" calculation
  const monthKey = (y, m) => `${y}-${String(m + 1).padStart(2, "0")}`;
  const namedByMonth = {};
  for (const d of campaignData) {
    const k = monthKey(d.year, d.month);
    if (!namedByMonth[k]) namedByMonth[k] = { clicks: 0, impressions: 0, cost: 0, conversions: 0 };
    namedByMonth[k].clicks += d.clicks;
    namedByMonth[k].impressions += d.impressions;
    namedByMonth[k].cost += d.cost;
    namedByMonth[k].conversions += d.conversions;
  }

  // Compute "Otras campañas" from account totals minus named campaigns
  for (const at of accountTotals) {
    const k = monthKey(at.year, at.month);
    const named = namedByMonth[k] || { clicks: 0, impressions: 0, cost: 0, conversions: 0 };
    const otherClicks = Math.max(0, at.clicks - named.clicks);
    const otherImpr = Math.max(0, at.impressions - named.impressions);
    const otherCost = Math.round((at.cost - named.cost) * 100) / 100;
    const otherConv = Math.max(0, at.conversions - named.conversions);
    if (otherCost > 0.01 || otherConv > 0) {
      campaignData.push({
        year: at.year, month: at.month, campaign: "Otras campañas",
        clicks: otherClicks, impressions: otherImpr, cost: otherCost, conversions: otherConv,
      });
    }
  }

  // Unique campaigns
  const campaignNames = [...new Set(campaignData.map(d => d.campaign))];
  console.log(`Campañas: ${campaignNames.join(", ")}`);
  console.log(`Meses con datos: ${accountTotals.length}\n`);

  // Show summary
  let grandCost = 0, grandConv = 0, grandClicks = 0, grandImpr = 0;
  for (const name of campaignNames) {
    const rows = campaignData.filter(d => d.campaign === name);
    const totCost = rows.reduce((s, r) => s + r.cost, 0);
    const totConv = rows.reduce((s, r) => s + r.conversions, 0);
    const totClicks = rows.reduce((s, r) => s + r.clicks, 0);
    console.log(`  ${name}: ${totConv} conv, ${totClicks} clics, €${totCost.toFixed(2)}`);
    grandCost += totCost;
    grandConv += totConv;
    grandClicks += totClicks;
  }
  console.log(`  TOTAL: ${grandConv} conv, ${grandClicks} clics, €${grandCost.toFixed(2)}\n`);

  // Distribute monthly data across days
  const dbRows = [];
  for (const d of campaignData) {
    const days = daysInMonth(d.year, d.month);
    const dailyClicks = d.clicks / days;
    const dailyImpr = d.impressions / days;
    const dailyCostMicros = Math.round(d.cost * 1_000_000 / days);
    const dailyConv = d.conversions / days;

    for (let day = 1; day <= days; day++) {
      const date = `${d.year}-${String(d.month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      dbRows.push({
        date,
        account_id: "b2c-deutsch",
        campaign_id: d.campaign.toLowerCase().replace(/\s+/g, "-"),
        campaign_name: d.campaign,
        impressions: Math.round(dailyImpr),
        clicks: Math.round(dailyClicks),
        cost_micros: dailyCostMicros,
        conversions: parseFloat(dailyConv.toFixed(4)),
        currency: "EUR",
      });
    }
  }

  console.log(`Generando ${dbRows.length} filas diarias...`);

  // Clean existing data first
  console.log("Limpiando datos anteriores...");
  const { error: delErr } = await sb
    .from("google_ads_daily")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000");
  if (delErr) console.error(`Error limpiando: ${delErr.message}`);

  // Upsert in batches
  const BATCH = 500;
  let inserted = 0;
  for (let i = 0; i < dbRows.length; i += BATCH) {
    const batch = dbRows.slice(i, i + BATCH);
    const { error } = await sb
      .from("google_ads_daily")
      .upsert(batch, { onConflict: "date,account_id,campaign_id" });
    if (error) {
      console.error(`Error en batch ${i}: ${error.message}`);
    } else {
      inserted += batch.length;
    }
  }
  console.log(`✓ ${inserted} filas insertadas\n`);

  await verifyTotals();
}

// ---------------------------------------------------------------------------
// Aggregated report import (legacy format)
// ---------------------------------------------------------------------------

async function importAggregatedReport() {
  console.log("Formato detectado: Reporte agregado (legacy)\n");

  const dateRangeLine = lines[1].trim();
  const [startStr, endStr] = dateRangeLine.split(" - ");
  const startDate = parseSpanishDate(startStr);
  const endDate = parseSpanishDate(endStr);
  const totalDays = Math.round((endDate - startDate) / 86_400_000) + 1;

  console.log(`Periodo: ${startDate.toISOString().slice(0, 10)} → ${endDate.toISOString().slice(0, 10)} (${totalDays} días)`);

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

  console.log(`✓ ${inserted} filas insertadas/actualizadas\n`);
  await verifyTotals();
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

async function verifyTotals() {
  const { data: verify } = await sb
    .from("google_ads_daily")
    .select("campaign_name, cost_micros, conversions, clicks, impressions");

  const totals = {};
  for (const r of (verify || [])) {
    const name = r.campaign_name || "?";
    if (!totals[name]) totals[name] = { cost: 0, conv: 0, clicks: 0, impr: 0 };
    totals[name].cost += Number(r.cost_micros);
    totals[name].conv += Number(r.conversions);
    totals[name].clicks += Number(r.clicks);
    totals[name].impr += Number(r.impressions);
  }

  console.log("=== Verificación en BD ===");
  let totalConv = 0, totalCost = 0, totalClicks = 0;
  for (const [name, t] of Object.entries(totals)) {
    console.log(`  ${name}: ${t.conv.toFixed(1)} conv, ${t.clicks} clics, €${(t.cost / 1_000_000).toFixed(2)}`);
    totalConv += t.conv;
    totalCost += t.cost;
    totalClicks += t.clicks;
  }
  console.log(`  TOTAL: ${Math.round(totalConv)} conv, ${totalClicks} clics, €${(totalCost / 1_000_000).toFixed(2)} gasto`);

  // Monthly breakdown
  const { data: monthly } = await sb
    .from("google_ads_daily")
    .select("date, cost_micros, conversions, clicks");
  const byMonth = {};
  for (const r of (monthly || [])) {
    const m = r.date.slice(0, 7);
    if (!byMonth[m]) byMonth[m] = { cost: 0, conv: 0, clicks: 0 };
    byMonth[m].cost += Number(r.cost_micros);
    byMonth[m].conv += Number(r.conversions);
    byMonth[m].clicks += Number(r.clicks);
  }
  console.log("\n=== Desglose mensual ===");
  for (const [m, t] of Object.entries(byMonth).sort()) {
    console.log(`  ${m}: ${Math.round(t.conv)} conv, ${t.clicks} clics, €${(t.cost / 1_000_000).toFixed(2)}`);
  }
}
