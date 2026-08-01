import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { Resend } from "resend";

/**
 * GET/POST /api/cron/ads-export-health
 *
 * Daily 08:00 (Vercel Cron). Alerta si el export offline de
 * conversiones a Google Ads (cron ads-conversions-export) no está
 * subiendo filas — bug histórico que rompía en silencio (Gelfis
 * 2026-07-28).
 *
 * Criterios de alarma:
 *   1. Hay leads con status='converted' + gclid IS NOT NULL +
 *      ads_conversion_uploaded_at IS NULL creados hace >24h
 *      (deberían haberse subido ya).
 *   2. O: hay leads trial_attended_at NOT NULL + gclid IS NOT NULL
 *      + ads_attended_uploaded_at IS NULL de hace >24h.
 *   3. O: NINGÚN lead tiene ads_conversion_uploaded_at
 *      actualizado en los últimos 7 días (mientras leads elegibles
 *      existen).
 *
 * Si dispara: manda email a NEW_LEAD_ALERT_EMAIL con el detalle
 * (leads pendientes, timestamps de última subida).
 *
 * Auth: CRON_SECRET.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALERT_EMAIL = process.env.NEW_LEAD_ALERT_EMAIL ?? "";
const RESEND_KEY  = process.env.RESEND_API_KEY ?? "";
const RESEND_FROM = process.env.RESEND_FROM_EMAIL ?? "no-reply@aprender-aleman.de";

function authorised(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const bearer = req.headers.get("authorization");
  if (bearer && bearer.toLowerCase().startsWith("bearer ") && bearer.slice(7).trim() === expected) return true;
  return req.headers.get("x-cron-secret") === expected;
}

export async function GET(req: Request)  { return run(req); }
export async function POST(req: Request) { return run(req); }

async function run(req: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "cron_not_configured" }, { status: 503 });
  }
  if (!authorised(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const sb = supabaseAdmin();
  const dayAgoIso  = new Date(Date.now() - 24 * 3600_000).toISOString();
  const weekAgoIso = new Date(Date.now() -  7 * 24 * 3600_000).toISOString();

  // 1. Convertidos con gclid pendientes de subir hace >24h
  const { data: convertedPending, count: convPendCount } = await sb
    .from("leads")
    .select("id, name, email, gclid, converted_at, ads_conversion_uploaded_at", { count: "exact" })
    .eq("status", "converted")
    .not("gclid", "is", null)
    .is("ads_conversion_uploaded_at", null)
    .lt("converted_at", dayAgoIso)
    .order("converted_at", { ascending: true })
    .limit(20);

  // 2. Trial-attended con gclid pendientes de subir hace >24h
  const { data: attendedPending, count: attPendCount } = await sb
    .from("leads")
    .select("id, name, email, gclid, trial_attended_at, ads_attended_uploaded_at", { count: "exact" })
    .not("trial_attended_at", "is", null)
    .not("gclid", "is", null)
    .is("ads_attended_uploaded_at", null)
    .lt("trial_attended_at", dayAgoIso)
    .order("trial_attended_at", { ascending: true })
    .limit(20);

  // 3. Última subida a Google (más reciente en cualquier lead)
  const { data: lastUpload } = await sb
    .from("leads")
    .select("ads_conversion_uploaded_at")
    .not("ads_conversion_uploaded_at", "is", null)
    .order("ads_conversion_uploaded_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const lastUploadAt = (lastUpload as { ads_conversion_uploaded_at: string } | null)?.ads_conversion_uploaded_at ?? null;
  const stale = !lastUploadAt || new Date(lastUploadAt) < new Date(weekAgoIso);

  const convPend = convPendCount ?? 0;
  const attPend  = attPendCount  ?? 0;
  const shouldAlert = convPend > 0 || attPend > 0 || stale;

  if (!shouldAlert) {
    return NextResponse.json({
      ok:                true,
      alert:             false,
      converted_pending: convPend,
      attended_pending:  attPend,
      last_upload_at:    lastUploadAt,
    });
  }

  // Compose alert body.
  const lines: string[] = [];
  lines.push(`⚠️ ALERTA — Export de conversiones a Google Ads con problemas`);
  lines.push("");
  lines.push(`Última subida a Google: ${lastUploadAt ?? "NUNCA"}`);
  if (stale) lines.push(`  → ⚠️ Han pasado más de 7 días — el cron ads-conversions-export puede estar caído.`);
  lines.push("");
  lines.push(`Leads CONVERTIDOS pendientes (con gclid, sin subir): ${convPend}`);
  if (convertedPending && convertedPending.length > 0) {
    for (const l of convertedPending.slice(0, 5)) {
      const row = l as { id: string; name: string | null; email: string | null; converted_at: string };
      lines.push(`  · ${row.name ?? row.email ?? row.id.slice(0,8)} — convirtió ${row.converted_at?.slice(0,10)}`);
    }
    if (convertedPending.length > 5) lines.push(`  ... y ${convertedPending.length - 5} más`);
  }
  lines.push("");
  lines.push(`Leads ASISTIERON trial pendientes (con gclid, sin subir): ${attPend}`);
  if (attendedPending && attendedPending.length > 0) {
    for (const l of attendedPending.slice(0, 5)) {
      const row = l as { id: string; name: string | null; email: string | null; trial_attended_at: string };
      lines.push(`  · ${row.name ?? row.email ?? row.id.slice(0,8)} — asistió ${row.trial_attended_at?.slice(0,10)}`);
    }
    if (attendedPending.length > 5) lines.push(`  ... y ${attendedPending.length - 5} más`);
  }
  lines.push("");
  lines.push(`Revisar:`);
  lines.push(`  · Cron /api/cron/ads-conversions-export en Vercel (¿está corriendo?)`);
  lines.push(`  · GADS_CONVERSION_NAME env matches Google Ads UI exactly`);
  lines.push(`  · Google Sheet destino sigue existiendo con permisos correctos`);
  lines.push(`  · Logs de Vercel del último run del cron`);

  const body = lines.join("\n");

  console.warn("[ads-export-health] ALERT:", { convPend, attPend, stale, lastUploadAt });

  if (ALERT_EMAIL && RESEND_KEY) {
    try {
      const resend = new Resend(RESEND_KEY);
      await resend.emails.send({
        from:    RESEND_FROM,
        to:      ALERT_EMAIL,
        subject: `⚠️ Ads export con retraso — ${convPend + attPend} conversiones sin subir`,
        text:    body,
      });
    } catch (err) {
      console.error("[ads-export-health] email send failed:", err);
    }
  }

  return NextResponse.json({
    ok:                true,
    alert:             true,
    converted_pending: convPend,
    attended_pending:  attPend,
    last_upload_at:    lastUploadAt,
    stale,
    alerted_email:     !!ALERT_EMAIL,
  });
}
