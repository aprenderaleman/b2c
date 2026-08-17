import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { createClient } = require("../web/node_modules/@supabase/supabase-js");

const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_KEY) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY en el entorno (ver web/.env.local)");
const sb = createClient("https://mtemnkmxajaluocfekbx.supabase.co", SUPABASE_KEY);

const months = [
  { label: "Nov 2025", from: "2025-11-01", to: "2025-11-30" },
  { label: "Dic 2025", from: "2025-12-01", to: "2025-12-31" },
  { label: "Ene 2026", from: "2026-01-01", to: "2026-01-31" },
  { label: "Feb 2026", from: "2026-02-01", to: "2026-02-28" },
  { label: "Mar 2026", from: "2026-03-01", to: "2026-03-31" },
  { label: "Abr 2026", from: "2026-04-01", to: "2026-04-30" },
  { label: "May 2026", from: "2026-05-01", to: "2026-05-31" },
  { label: "Jun 2026", from: "2026-06-01", to: "2026-06-14" },
];

for (const m of months) {
  // Revenue
  const { data: payments } = await sb
    .from("payments")
    .select("amount_cents, currency, type, student_id")
    .eq("status", "paid")
    .gte("paid_at", m.from + "T00:00:00Z")
    .lte("paid_at", m.to + "T23:59:59Z");

  const revenueCents = (payments ?? []).reduce((s, r) => s + Number(r.amount_cents), 0);
  const paymentCount = (payments ?? []).length;
  const uniqueStudents = new Set((payments ?? []).map(p => p.student_id)).size;

  // Revenue by type
  const byType = {};
  for (const p of (payments ?? [])) {
    byType[p.type] = (byType[p.type] || 0) + Number(p.amount_cents);
  }

  // Teacher payroll
  const { data: hours } = await sb
    .from("class_hours_log")
    .select("amount_cents")
    .gte("created_at", m.from + "T00:00:00Z")
    .lte("created_at", m.to + "T23:59:59Z");
  const payrollCents = (hours ?? []).reduce((s, r) => s + Number(r.amount_cents), 0);

  // Fixed costs
  const { data: fixed } = await sb
    .from("costes_fijos")
    .select("amount_cents")
    .eq("active", true)
    .lte("starts_at", m.to)
    .or(`ends_at.is.null,ends_at.gte.${m.from}`);
  const fixedCents = (fixed ?? []).reduce((s, r) => s + Number(r.amount_cents), 0);

  // Google Ads spend
  const { data: ads } = await sb
    .from("google_ads_daily")
    .select("cost_micros")
    .gte("date", m.from)
    .lte("date", m.to);
  const adsMicros = (ads ?? []).reduce((s, r) => s + Number(r.cost_micros), 0);
  const adsCents = Math.round(adsMicros / 10000);

  // Variable expenses (excluding ads)
  const { data: expenses } = await sb
    .from("business_expenses")
    .select("amount_cents, category")
    .gte("incurred_at", m.from)
    .lte("incurred_at", m.to);
  const totalExpCents = (expenses ?? []).reduce((s, r) => s + Number(r.amount_cents), 0);
  const adsExpCents = (expenses ?? []).filter(e => e.category === "ads").reduce((s, r) => s + Number(r.amount_cents), 0);
  const varExpCents = totalExpCents - adsExpCents;

  // Leads & Funnel
  const { count: leadsCount } = await sb
    .from("leads")
    .select("id", { count: "exact", head: true })
    .gte("created_at", m.from + "T00:00:00Z")
    .lte("created_at", m.to + "T23:59:59Z");

  const { count: trialsCount } = await sb
    .from("leads")
    .select("id", { count: "exact", head: true })
    .gte("created_at", m.from + "T00:00:00Z")
    .lte("created_at", m.to + "T23:59:59Z")
    .not("trial_scheduled_at", "is", null);

  const { count: convertedCount } = await sb
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("status", "converted")
    .gte("converted_at", m.from + "T00:00:00Z")
    .lte("converted_at", m.to + "T23:59:59Z");

  // Calculations
  const brutoCents = revenueCents - payrollCents;
  const netoCents = brutoCents - varExpCents - fixedCents - adsCents;
  const margenBruto = revenueCents > 0 ? (brutoCents / revenueCents * 100) : 0;
  const margenNeto = revenueCents > 0 ? (netoCents / revenueCents * 100) : 0;
  const cpl = (leadsCount ?? 0) > 0 ? adsCents / (leadsCount ?? 1) : 0;
  const cac = (convertedCount ?? 0) > 0 ? (adsCents + fixedCents + varExpCents) / (convertedCount ?? 1) : 0;
  const roas = adsCents > 0 ? revenueCents / adsCents : 0;

  console.log(`\n${"=".repeat(60)}`);
  console.log(`  ${m.label}`);
  console.log(`${"=".repeat(60)}`);
  console.log(`  Ingresos:          ${(revenueCents/100).toFixed(2)} EUR (${paymentCount} pagos, ${uniqueStudents} estudiantes)`);
  for (const [type, cents] of Object.entries(byType)) {
    console.log(`    - ${type}: ${(cents/100).toFixed(2)} EUR`);
  }
  console.log(`  Nomina profesores: ${(payrollCents/100).toFixed(2)} EUR`);
  console.log(`  Gastos variables:  ${(varExpCents/100).toFixed(2)} EUR`);
  console.log(`  Costes fijos:      ${(fixedCents/100).toFixed(2)} EUR`);
  console.log(`  Google Ads:        ${(adsCents/100).toFixed(2)} EUR (${(ads ?? []).length} dias)`);
  console.log(`  ---`);
  console.log(`  Beneficio Bruto:   ${(brutoCents/100).toFixed(2)} EUR (${margenBruto.toFixed(1)}%)`);
  console.log(`  Beneficio Neto:    ${(netoCents/100).toFixed(2)} EUR (${margenNeto.toFixed(1)}%)`);
  console.log(`  ---`);
  console.log(`  Leads:             ${leadsCount ?? 0}`);
  console.log(`  Trials agendados:  ${trialsCount ?? 0}`);
  console.log(`  Conversiones:      ${convertedCount ?? 0}`);
  console.log(`  CPL:               ${(cpl/100).toFixed(2)} EUR`);
  console.log(`  CAC:               ${(cac/100).toFixed(2)} EUR`);
  console.log(`  ROAS:              ${roas.toFixed(2)}x`);
}

// Total acumulado
console.log(`\n${"=".repeat(60)}`);
console.log(`  ACUMULADO (Nov 2025 - Jun 2026)`);
console.log(`${"=".repeat(60)}`);

const { data: allPayments } = await sb.from("payments").select("amount_cents").eq("status", "paid").gte("paid_at", "2025-11-01T00:00:00Z").lte("paid_at", "2026-06-14T23:59:59Z");
const { data: allHours } = await sb.from("class_hours_log").select("amount_cents").gte("created_at", "2025-11-01T00:00:00Z").lte("created_at", "2026-06-14T23:59:59Z");
const { data: allAds } = await sb.from("google_ads_daily").select("cost_micros").gte("date", "2025-11-01").lte("date", "2026-06-14");
const { data: allFixed } = await sb.from("costes_fijos").select("amount_cents").eq("active", true);
const { count: allLeads } = await sb.from("leads").select("id", { count: "exact", head: true }).gte("created_at", "2025-11-01T00:00:00Z").lte("created_at", "2026-06-14T23:59:59Z");
const { count: allConv } = await sb.from("leads").select("id", { count: "exact", head: true }).eq("status", "converted").gte("converted_at", "2025-11-01T00:00:00Z").lte("converted_at", "2026-06-14T23:59:59Z");

const totRev = (allPayments ?? []).reduce((s, r) => s + Number(r.amount_cents), 0);
const totPay = (allHours ?? []).reduce((s, r) => s + Number(r.amount_cents), 0);
const totAds = Math.round((allAds ?? []).reduce((s, r) => s + Number(r.cost_micros), 0) / 10000);
const totFixed = (allFixed ?? []).reduce((s, r) => s + Number(r.amount_cents), 0) * 7.5; // ~7.5 months
const totBruto = totRev - totPay;
const totNeto = totBruto - totAds - totFixed;

console.log(`  Ingresos totales:  ${(totRev/100).toFixed(2)} EUR`);
console.log(`  Nomina total:      ${(totPay/100).toFixed(2)} EUR`);
console.log(`  Google Ads total:  ${(totAds/100).toFixed(2)} EUR`);
console.log(`  Costes fijos est:  ${(totFixed/100).toFixed(2)} EUR (~7.5 meses)`);
console.log(`  Beneficio Bruto:   ${(totBruto/100).toFixed(2)} EUR (${(totBruto/totRev*100).toFixed(1)}%)`);
console.log(`  Beneficio Neto:    ${(totNeto/100).toFixed(2)} EUR (${(totNeto/totRev*100).toFixed(1)}%)`);
console.log(`  Leads totales:     ${allLeads ?? 0}`);
console.log(`  Conversiones:      ${allConv ?? 0}`);
console.log(`  CPL global:        ${((totAds / (allLeads ?? 1))/100).toFixed(2)} EUR`);
console.log(`  CAC global:        ${((allConv ?? 0) > 0 ? ((totAds + totFixed) / (allConv ?? 1))/100 : 0).toFixed(2)} EUR`);
console.log(`  ROAS global:       ${(totRev / totAds).toFixed(2)}x`);
