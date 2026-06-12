import { NextResponse } from "next/server";
import { pollEmailInbound, imapConfigured } from "@/lib/email/inbound-imap";

/**
 * GET/POST /api/cron/email-inbound-poll
 *
 * Polling de respuestas email entrantes. Marca cada match como
 * lead_message_received con metadata.channel='email' para que /admin/mensajes
 * pueda medir la tasa de respuesta de los kinds email-only.
 *
 * Schedule sugerido en vercel.json: cada 5 min.
 *
 * Auth: Bearer CRON_SECRET o X-Cron-Secret.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;  // 1 min — IMAP puede ser lento

function authorised(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const bearer = req.headers.get("authorization");
  if (bearer && bearer.toLowerCase().startsWith("bearer ") && bearer.slice(7).trim() === expected) {
    return true;
  }
  return req.headers.get("x-cron-secret") === expected;
}

async function run(req: Request) {
  if (!authorised(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!imapConfigured()) {
    return NextResponse.json({
      ok: false,
      reason: "imap_not_configured",
      help: "Anade IMAP_HOST / IMAP_USER / IMAP_PASS (opcional IMAP_PORT, IMAP_TLS) en Vercel.",
    }, { status: 200 });
  }

  const t0 = Date.now();
  const result = await pollEmailInbound();
  const took_ms = Date.now() - t0;
  return NextResponse.json({ ok: true, took_ms, ...result });
}

export async function GET(req: Request)  { return run(req); }
export async function POST(req: Request) { return run(req); }
