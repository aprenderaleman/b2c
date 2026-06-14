import { NextResponse } from "next/server";
import { requireRole } from "@/lib/rbac";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  await requireRole(["superadmin", "admin"]);

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) {
    return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  }

  const text = await file.text();
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) {
    return NextResponse.json({ error: "CSV is empty" }, { status: 400 });
  }

  const header = lines[0].toLowerCase();
  const sep = header.includes("\t") ? "\t" : ",";
  const cols = header.split(sep).map((c) => c.trim().replace(/^"/, "").replace(/"$/, ""));

  const dateIdx = cols.findIndex((c) => c === "day" || c === "date" || c === "dia" || c === "fecha");
  const campaignIdx = cols.findIndex((c) => c.includes("campaign") || c.includes("campaña") || c.includes("campana"));
  const impressionsIdx = cols.findIndex((c) => c.includes("impression") || c.includes("impresion"));
  const clicksIdx = cols.findIndex((c) => c.includes("click"));
  const costIdx = cols.findIndex((c) => c.includes("cost") || c.includes("coste") || c.includes("gasto"));
  const conversionsIdx = cols.findIndex((c) => c.includes("conversion"));

  if (dateIdx === -1 || costIdx === -1) {
    return NextResponse.json(
      { error: "CSV must have at least 'Day/Date' and 'Cost' columns" },
      { status: 400 },
    );
  }

  const sb = supabaseAdmin();
  let inserted = 0;
  let updated = 0;
  const errors: string[] = [];

  for (let i = 1; i < lines.length; i++) {
    const vals = parseCsvLine(lines[i], sep);
    if (vals.length <= Math.max(dateIdx, costIdx)) continue;

    const rawDate = vals[dateIdx].trim();
    const date = parseDate(rawDate);
    if (!date) {
      errors.push(`Row ${i + 1}: invalid date "${rawDate}"`);
      continue;
    }

    const campaignName = campaignIdx >= 0 ? vals[campaignIdx].trim() : "all";
    const campaignId = campaignName.replace(/\s+/g, "_").toLowerCase();
    const impressions = impressionsIdx >= 0 ? parseNumber(vals[impressionsIdx]) : 0;
    const clicks = clicksIdx >= 0 ? parseNumber(vals[clicksIdx]) : 0;
    const costEur = parseCost(vals[costIdx]);
    const costMicros = Math.round(costEur * 1_000_000);
    const conversions = conversionsIdx >= 0 ? parseNumber(vals[conversionsIdx]) : 0;

    const { data, error } = await sb
      .from("google_ads_daily")
      .upsert(
        {
          date,
          account_id: "csv_import",
          campaign_id: campaignId,
          campaign_name: campaignName,
          impressions,
          clicks,
          cost_micros: costMicros,
          conversions,
          currency: "EUR",
          fetched_at: new Date().toISOString(),
        },
        { onConflict: "date,account_id,campaign_id" },
      )
      .select("id");

    if (error) {
      errors.push(`Row ${i + 1}: ${error.message}`);
    } else if (data && data.length > 0) {
      inserted++;
    }
  }

  return NextResponse.json({
    ok: true,
    inserted,
    errors: errors.slice(0, 10),
    total_rows: lines.length - 1,
  });
}

function parseCsvLine(line: string, sep: string): string[] {
  if (sep === "\t") return line.split("\t");
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === sep && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result.map((v) => v.trim().replace(/^"/, "").replace(/"$/, ""));
}

function parseDate(raw: string): string | null {
  // Supports: 2026-06-13, Jun 13 2026, 13/06/2026, 2026/06/13
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
  if (iso) return iso;

  const slash = raw.match(/^(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})$/);
  if (slash) {
    const [, d, m, y] = slash;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  const d = new Date(raw);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

function parseNumber(raw: string): number {
  const n = Number(raw.replace(/[^0-9.-]/g, ""));
  return isNaN(n) ? 0 : Math.round(n);
}

function parseCost(raw: string): number {
  // Handle European format: "1.234,56" → 1234.56
  let cleaned = raw.trim().replace(/[€$\s]/g, "");
  if (/\d\.\d{3},/.test(cleaned)) {
    cleaned = cleaned.replace(/\./g, "").replace(",", ".");
  } else if (/,\d{2}$/.test(cleaned)) {
    cleaned = cleaned.replace(",", ".");
  }
  const n = Number(cleaned);
  return isNaN(n) ? 0 : n;
}
