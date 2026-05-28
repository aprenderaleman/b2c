import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import {
  sheetsConfigured,
  ensureConversionHeader,
  appendConversions,
  type ConversionRow,
} from "@/lib/google-sheets";

/**
 * GET/POST /api/cron/ads-conversions-export
 *
 * Exporta a una Google Sheet las conversiones offline (lead → cliente)
 * para que Google Ads las importe y atribuya al anuncio que trajo al
 * lead. Sólo exporta leads que:
 *   - status = 'converted'
 *   - tienen gclid (vinieron de un clic en anuncio de Google)
 *   - aún no se han subido (ads_conversion_uploaded_at IS NULL)
 *
 * Tras subirlos, marca ads_conversion_uploaded_at para no duplicar.
 *
 * Vercel Cron lo dispara cada hora. Idempotente.
 *
 * Setup (una vez): ver lib/google-sheets.ts — crear hoja, compartirla
 * con el service account, poner GADS_CONVERSIONS_SHEET_ID.
 *
 * Auth: Bearer CRON_SECRET o X-Cron-Secret.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Nombre EXACTO de la acción de conversión en Google Ads. Debe coincidir
// con el nombre configurado allí o Google rechaza las filas.
const CONVERSION_NAME = process.env.GADS_CONVERSION_NAME ?? "Cliente convertido (offline)";
// Valor por defecto de una conversión si el lead no tiene conversion_value.
const DEFAULT_VALUE = Number(process.env.GADS_CONVERSION_DEFAULT_VALUE ?? "300");

function authorised(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const bearer = req.headers.get("authorization");
  if (bearer && bearer.toLowerCase().startsWith("bearer ")) {
    if (bearer.slice(7).trim() === expected) return true;
  }
  return req.headers.get("x-cron-secret") === expected;
}

// Formato de tiempo que acepta Google Ads: "yyyy-MM-dd HH:mm:ss+HH:mm".
// La cabecera de la hoja declara TimeZone=Europe/Berlin, así que damos
// el tiempo en hora de Berlín con su offset.
function formatBerlin(iso: string): string {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Berlin",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? "00";
  // Offset de Berlín (CET +01:00 / CEST +02:00) — lo calculamos.
  const offMin = -new Date(d.toLocaleString("en-US", { timeZone: "Europe/Berlin" })).getTimezoneOffset();
  // Nota: cálculo simple; Google tolera el offset estándar. Usamos +02:00
  // en verano, +01:00 en invierno via Intl.
  const tzName = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Berlin", timeZoneName: "shortOffset" })
    .formatToParts(d).find(p => p.type === "timeZoneName")?.value ?? "GMT+1";
  const m = tzName.match(/GMT([+-]\d+)/);
  const offHours = m ? parseInt(m[1], 10) : 1;
  const sign = offHours >= 0 ? "+" : "-";
  const offStr = `${sign}${String(Math.abs(offHours)).padStart(2, "0")}:00`;
  void offMin;
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")}${offStr}`;
}

export async function GET(req: Request)  { return run(req); }
export async function POST(req: Request) { return run(req); }

async function run(req: Request) {
  if (!authorised(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!sheetsConfigured()) {
    return NextResponse.json({ ok: true, skipped: "sheets_not_configured" });
  }

  const sb = supabaseAdmin();

  // Conversiones pendientes: convertidas, con gclid, sin subir.
  const { data: leads, error } = await sb
    .from("leads")
    .select("id, name, gclid, converted_at, conversion_value, updated_at")
    .eq("status", "converted")
    .not("gclid", "is", null)
    .is("ads_conversion_uploaded_at", null)
    .limit(200);

  if (error) {
    console.error("[ads-conversions-export] query failed:", error.message);
    return NextResponse.json({ ok: false, error: "db_error" }, { status: 500 });
  }
  if (!leads || leads.length === 0) {
    return NextResponse.json({ ok: true, exported: 0 });
  }

  await ensureConversionHeader();

  const rows: ConversionRow[] = [];
  const ids: string[] = [];
  for (const l of leads as Array<{
    id: string; gclid: string | null;
    converted_at: string | null; conversion_value: number | null;
    updated_at: string | null;
  }>) {
    if (!l.gclid) continue;
    const when = l.converted_at ?? l.updated_at ?? new Date().toISOString();
    rows.push({
      gclid:          l.gclid,
      conversionName: CONVERSION_NAME,
      conversionTime: formatBerlin(when),
      value:          l.conversion_value ?? DEFAULT_VALUE,
      currency:       "EUR",
    });
    ids.push(l.id);
  }

  const written = await appendConversions(rows);
  if (written < 0) {
    return NextResponse.json({ ok: false, error: "sheet_append_failed" }, { status: 502 });
  }

  // Marcar como subidas para no duplicar.
  if (ids.length > 0) {
    await sb.from("leads")
      .update({ ads_conversion_uploaded_at: new Date().toISOString() })
      .in("id", ids);
  }

  return NextResponse.json({ ok: true, exported: written });
}
