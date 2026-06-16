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
 * Exporta a una Google Sheet TODAS las conversiones offline para que
 * Google Ads las importe y Smart Bidding optimice contra señales reales
 * de calidad (no solo "reservó").
 *
 * 2 tipos de conversion (Gelfis 2026-06-16) — Smart Bidding en cascada:
 *
 *   1. "Asistió a clase de prueba"  → leads.trial_attended_at IS NOT NULL
 *      value default: 15 EUR (calidad media — confirmó interés)
 *      tracking: ads_attended_uploaded_at
 *
 *   2. "Cliente convertido (offline)" → leads.status = 'converted'
 *      value: leads.conversion_value (real) o default 300 EUR
 *      tracking: ads_conversion_uploaded_at  (columna histórica)
 *
 * Filtro común: gclid IS NOT NULL (sin clic de Google no hay
 * atribución posible — leads orgánicos no se suben).
 *
 * Vercel Cron lo dispara cada hora. Idempotente — cada tipo tiene su
 * propio timestamp anti-duplicado.
 *
 * Setup (una vez): ver lib/google-sheets.ts + crear las 2 conversion
 * actions en Google Ads UI con los nombres que matchean
 * GADS_*_CONVERSION_NAME.
 *
 * Auth: Bearer CRON_SECRET o X-Cron-Secret.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Nombres EXACTOS de las conversion actions en Google Ads. Deben
// coincidir o Google rechaza las filas (silently — solo verás "0
// imported" en el reporte).
const CONVERSION_NAME_PAID     = process.env.GADS_CONVERSION_NAME          ?? "Cliente convertido (offline)";
const CONVERSION_NAME_ATTENDED = process.env.GADS_ATTENDED_CONVERSION_NAME ?? "Asistió a clase de prueba";

// Valores por defecto si el lead no tiene conversion_value. Smart
// Bidding los usa para priorizar bids — paid > attended.
const DEFAULT_VALUE_PAID     = Number(process.env.GADS_CONVERSION_DEFAULT_VALUE          ?? "300");
const DEFAULT_VALUE_ATTENDED = Number(process.env.GADS_ATTENDED_DEFAULT_VALUE            ?? "15");

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
  const tzName = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Berlin", timeZoneName: "shortOffset" })
    .formatToParts(d).find(p => p.type === "timeZoneName")?.value ?? "GMT+1";
  const m = tzName.match(/GMT([+-]\d+)/);
  const offHours = m ? parseInt(m[1], 10) : 1;
  const sign = offHours >= 0 ? "+" : "-";
  const offStr = `${sign}${String(Math.abs(offHours)).padStart(2, "0")}:00`;
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

  // ── Pendientes: "Attended" ──────────────────────────────────────
  // Lead asistió al trial y tiene gclid, pero aún no se subió.
  const { data: attendedLeads, error: attendedErr } = await sb
    .from("leads")
    .select("id, gclid, trial_attended_at")
    .not("gclid", "is", null)
    .not("trial_attended_at", "is", null)
    .is("ads_attended_uploaded_at", null)
    .limit(200);
  if (attendedErr) {
    console.error("[ads-conversions-export] attended query failed:", attendedErr.message);
    return NextResponse.json({ ok: false, error: "db_error_attended" }, { status: 500 });
  }

  // ── Pendientes: "Paid" ──────────────────────────────────────────
  // Lead pagó (status='converted') y tiene gclid, pero aún no se subió.
  const { data: paidLeads, error: paidErr } = await sb
    .from("leads")
    .select("id, gclid, converted_at, conversion_value, updated_at")
    .eq("status", "converted")
    .not("gclid", "is", null)
    .is("ads_conversion_uploaded_at", null)
    .limit(200);
  if (paidErr) {
    console.error("[ads-conversions-export] paid query failed:", paidErr.message);
    return NextResponse.json({ ok: false, error: "db_error_paid" }, { status: 500 });
  }

  const totalPending = (attendedLeads?.length ?? 0) + (paidLeads?.length ?? 0);
  if (totalPending === 0) {
    return NextResponse.json({ ok: true, exported: 0, attended: 0, paid: 0 });
  }

  await ensureConversionHeader();

  // ── Construir filas: una entrada por (lead, tipo de conversion) ──
  const rows: ConversionRow[] = [];
  const attendedIds: string[] = [];
  const paidIds:     string[] = [];

  for (const l of (attendedLeads ?? []) as Array<{
    id: string; gclid: string | null; trial_attended_at: string | null;
  }>) {
    if (!l.gclid || !l.trial_attended_at) continue;
    rows.push({
      gclid:          l.gclid,
      conversionName: CONVERSION_NAME_ATTENDED,
      conversionTime: formatBerlin(l.trial_attended_at),
      value:          DEFAULT_VALUE_ATTENDED,
      currency:       "EUR",
    });
    attendedIds.push(l.id);
  }

  for (const l of (paidLeads ?? []) as Array<{
    id: string; gclid: string | null;
    converted_at: string | null; conversion_value: number | null;
    updated_at: string | null;
  }>) {
    if (!l.gclid) continue;
    const when = l.converted_at ?? l.updated_at ?? new Date().toISOString();
    rows.push({
      gclid:          l.gclid,
      conversionName: CONVERSION_NAME_PAID,
      conversionTime: formatBerlin(when),
      value:          l.conversion_value ?? DEFAULT_VALUE_PAID,
      currency:       "EUR",
    });
    paidIds.push(l.id);
  }

  const written = await appendConversions(rows);
  if (written < 0) {
    return NextResponse.json({ ok: false, error: "sheet_append_failed" }, { status: 502 });
  }

  // ── Marcar como subidas (cada tipo en su columna) ────────────────
  const now = new Date().toISOString();
  if (attendedIds.length > 0) {
    await sb.from("leads")
      .update({ ads_attended_uploaded_at: now })
      .in("id", attendedIds);
  }
  if (paidIds.length > 0) {
    await sb.from("leads")
      .update({ ads_conversion_uploaded_at: now })
      .in("id", paidIds);
  }

  return NextResponse.json({
    ok:       true,
    exported: written,
    attended: attendedIds.length,
    paid:     paidIds.length,
  });
}
