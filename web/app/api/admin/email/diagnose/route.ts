import { NextResponse } from "next/server";
import { emailBackendConfigured } from "@/lib/email/client";

/**
 * GET /api/admin/email/diagnose?secret=X
 *
 * Reporta qué backend de email está activo (Resend/SMTP), FROM address,
 * si hay webhook secret configurado, y cualquier otra señal de salud.
 *
 * Gelfis 2026-11-16: debugging por qué leads dicen no recibir emails
 * aunque timeline los marca como enviados.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const expected = process.env.CRON_SECRET;
  const provided =
    url.searchParams.get("secret") ??
    req.headers.get("x-cron-secret") ??
    (req.headers.get("authorization")?.toLowerCase().startsWith("bearer ")
      ? req.headers.get("authorization")!.slice(7).trim()
      : null);
  if (!expected || provided !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const resendKey = !!process.env.RESEND_API_KEY;
  const resendWebhookSecret = !!process.env.RESEND_WEBHOOK_SECRET;
  const smtpHost = process.env.SMTP_HOST ?? null;
  const smtpUser = process.env.SMTP_USER ?? null;
  const smtpPort = process.env.SMTP_PORT ?? null;
  const smtpSecure = process.env.SMTP_SECURE ?? null;
  const emailFrom = process.env.EMAIL_FROM ?? "Aprender-Aleman.de <info@aprender-aleman.de>";
  const configured = emailBackendConfigured();

  // Which backend wins?
  let activeBackend: "resend" | "smtp" | "none" = "none";
  if (resendKey) activeBackend = "resend";
  else if (smtpHost && smtpUser) activeBackend = "smtp";

  // Test Resend API connectivity if configured
  let resendApiHealthy: boolean | null = null;
  let resendDomains: unknown = null;
  if (resendKey) {
    try {
      const r = await fetch("https://api.resend.com/domains", {
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
        signal: AbortSignal.timeout(8_000),
      });
      resendApiHealthy = r.ok;
      if (r.ok) {
        const data = (await r.json()) as unknown;
        resendDomains = data;
      }
    } catch (e) {
      resendApiHealthy = false;
      resendDomains = { error: e instanceof Error ? e.message : String(e) };
    }
  }

  return NextResponse.json({
    backend_configured: configured,
    active_backend: activeBackend,
    email_from: emailFrom,
    resend: {
      api_key_set: resendKey,
      webhook_secret_set: resendWebhookSecret,
      api_healthy: resendApiHealthy,
      domains: resendDomains,
    },
    smtp: {
      host: smtpHost,
      user: smtpUser ? smtpUser.replace(/(.{3}).*@/, "$1***@") : null,
      port: smtpPort,
      secure: smtpSecure,
    },
    recommendations: buildRecommendations(activeBackend, resendKey, resendWebhookSecret, resendApiHealthy),
  });
}

function buildRecommendations(
  backend: string,
  resendKey: boolean,
  webhookSecret: boolean,
  resendHealthy: boolean | null,
): string[] {
  const out: string[] = [];
  if (backend === "none") out.push("❌ NO backend configurado — emails caen a console.log (NO salen)");
  if (backend === "smtp") out.push("⚠️ Usando SMTP Hostinger — sin webhook de bounces/delivered. No tenemos visibility real.");
  if (backend === "resend" && !webhookSecret) out.push("⚠️ Resend sin RESEND_WEBHOOK_SECRET → eventos llegan pero no se verifican firma.");
  if (backend === "resend" && resendHealthy === false) out.push("❌ Resend API no responde — revisar RESEND_API_KEY.");
  if (backend === "resend" && resendHealthy === true) out.push("✓ Resend API responde. Verificar dominio verificado en respuesta /domains.");
  return out;
}
