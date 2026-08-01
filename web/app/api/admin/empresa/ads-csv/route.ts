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
  const rawLines = text.split(/\r?\n/).filter((l) => l.trim());
  if (rawLines.length < 2) {
    return NextResponse.json({ error: "CSV is empty" }, { status: 400 });
  }

  // Find the header row — skip metadata lines (e.g. "Informe de campaña", "Todo el período")
  let headerLineIdx = 0;
  for (let i = 0; i < Math.min(rawLines.length, 5); i++) {
    const lower = rawLines[i].toLowerCase();
    if (
      lower.includes("campaign") || lower.includes("campaña") ||
      lower.includes("cost") || lower.includes("costo") ||
      lower.includes("click") || lower.includes("clic")
    ) {
      headerLineIdx = i;
      break;
    }
  }

  const header = rawLines[headerLineIdx].toLowerCase();
  const sep = header.includes("\t") ? "\t" : ",";
  const cols = parseCsvLine(rawLines[headerLineIdx], sep).map((c) => c.toLowerCase());

  const dateIdx = cols.findIndex((c) =>
    c === "day" || c === "date" || c === "dia" || c === "día" || c === "fecha"
  );
  const campaignIdx = cols.findIndex((c) =>
    c.includes("campaign") || c.includes("campaña") || c.includes("campana")
  );
  const impressionsIdx = cols.findIndex((c) =>
    c.includes("impression") || c.includes("impresion") || c === "impr."
  );
  const clicksIdx = cols.findIndex((c) =>
    c.includes("click") || c.includes("clic")
  );
  const costIdx = cols.findIndex((c) =>
    c.includes("cost") || c.includes("costo") || c.includes("gasto")
  );
  const conversionsIdx = cols.findIndex((c) =>
    c.includes("conversion") || c.includes("conversiones")
  );

  if (costIdx === -1) {
    return NextResponse.json(
      { error: "No se encontro columna de coste (Cost/Costo) en el CSV" },
      { status: 400 },
    );
  }

  // If no date column, this is an aggregate report — reject it to avoid double-counting
  const isAggregate = dateIdx === -1;
  if (isAggregate) {
    return NextResponse.json(
      { error: "El CSV no tiene columna de fecha (Day/Date/Día). Exporta un informe diario desde Google Ads para evitar duplicar datos." },
      { status: 400 },
    );
  }

  const sb = supabaseAdmin();
  let inserted = 0;
  const errors: string[] = [];
  const dataLines = rawLines.slice(headerLineIdx + 1);

  for (let i = 0; i < dataLines.length; i++) {
    const line = dataLines[i];
    // Skip total/summary rows
    const lower = line.toLowerCase();
    if (lower.startsWith("total") || lower.startsWith('"total')) continue;

    const vals = parseCsvLine(line, sep);
    if (vals.length <= costIdx) continue;

    const costEur = parseCost(vals[costIdx]);
    if (costEur === 0) continue;

    const date = parseDate(vals[dateIdx].trim());
    if (!date) {
      errors.push(`Fila ${i + headerLineIdx + 2}: fecha invalida "${vals[dateIdx]}"`);
      continue;
    }

    const campaignName = campaignIdx >= 0 ? vals[campaignIdx].trim() : "all";
    // Skip rows where campaign is empty or looks like a total
    if (!campaignName || campaignName === "--" || campaignName === "-") continue;

    const campaignId = campaignName.replace(/\s+/g, "_").toLowerCase();
    const impressions = impressionsIdx >= 0 ? parseNumber(vals[impressionsIdx]) : 0;
    const clicks = clicksIdx >= 0 ? parseNumber(vals[clicksIdx]) : 0;
    const costMicros = Math.round(costEur * 1_000_000);
    const conversions = conversionsIdx >= 0 ? parseFloat(vals[conversionsIdx].replace(",", ".")) || 0 : 0;

    const { error } = await sb
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
      errors.push(`Fila ${i + headerLineIdx + 2}: ${error.message}`);
    } else {
      inserted++;
    }
  }

  return NextResponse.json({
    ok: true,
    inserted,
    errors: errors.slice(0, 10),
    total_rows: dataLines.length,
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
  let cleaned = raw.trim().replace(/[€$\s]/g, "");
  // European format: "1.234,56" → 1234.56
  if (/\d\.\d{3},/.test(cleaned)) {
    cleaned = cleaned.replace(/\./g, "").replace(",", ".");
  } else if (/,\d{2}$/.test(cleaned)) {
    cleaned = cleaned.replace(",", ".");
  }
  const n = Number(cleaned);
  return isNaN(n) ? 0 : n;
}
