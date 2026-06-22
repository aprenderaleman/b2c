import { NextResponse } from "next/server";
import { sendWhatsappText } from "@/lib/whatsapp";

/**
 * POST /api/admin/wa-test  body: { phone: "+49...", text: "..." }
 *
 * Manda UN WhatsApp arbitrario a un número arbitrario. SIN tocar leads,
 * SIN insertar timeline, SIN dedup. Pensado para validar copy antes de
 * lanzar campañas (Gelfis 2026-06-19).
 *
 * Auth: CRON_SECRET. Respeta el blocklist de lib/whatsapp.ts.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorised(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const bearer = req.headers.get("authorization");
  if (bearer && bearer.toLowerCase().startsWith("bearer ") && bearer.slice(7).trim() === expected) return true;
  return req.headers.get("x-cron-secret") === expected;
}

export async function POST(req: Request) {
  if (!authorised(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({})) as { phone?: string; text?: string };
  if (!body.phone || !body.text) {
    return NextResponse.json({ error: "missing_fields", required: ["phone","text"] }, { status: 400 });
  }
  const r = await sendWhatsappText(body.phone, body.text);
  if (!r.ok) return NextResponse.json({ ok: false, reason: r.reason }, { status: 502 });
  return NextResponse.json({ ok: true, messageId: r.messageId });
}
