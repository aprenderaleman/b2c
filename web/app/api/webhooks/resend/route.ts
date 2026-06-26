import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/webhooks/resend
 *
 * Recibe eventos de Resend (https://resend.com/docs/webhooks/types).
 * Eventos que nos importan:
 *  - email.bounced       → bounce permanente. Marca leads.email_status="bounced"
 *                          para parar todos los envíos futuros a ese lead.
 *  - email.complained    → reportó como spam. Marca "complained".
 *  - email.delivery_delayed → soft bounce. Marca "delivery_delayed" (info).
 *  - email.delivered     → confirmación entrega (opcional, info).
 *
 * Resto de eventos se ignoran silenciosamente.
 *
 * Autenticación: Resend firma con Svix-style. Si configuras
 * RESEND_WEBHOOK_SECRET, validamos la firma. Si no está seteado,
 * aceptamos cualquier POST (modo dev / migración inicial).
 */

type ResendEvent = {
  type:    string;
  created_at?: string;
  data?: {
    email_id?: string;
    from?:     string;
    to?:       string | string[];
    subject?:  string;
    bounce?:   { type?: string; subType?: string; message?: string };
    [k: string]: unknown;
  };
};

function verifySvixSignature(rawBody: string, headers: Headers, secret: string): boolean {
  // Resend usa Svix bajo el capó. Headers: svix-id, svix-timestamp,
  // svix-signature ("v1,base64sig v1,base64sig2 ...").
  const id  = headers.get("svix-id");
  const ts  = headers.get("svix-timestamp");
  const sig = headers.get("svix-signature");
  if (!id || !ts || !sig) return false;
  const signed = `${id}.${ts}.${rawBody}`;
  // El secret de Svix viene como "whsec_<base64>"; strip prefix.
  const cleanSecret = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  let key: Buffer;
  try { key = Buffer.from(cleanSecret, "base64"); }
  catch { return false; }
  const expected = createHmac("sha256", key).update(signed).digest("base64");
  // sig puede contener varias firmas separadas por espacio
  const sigs = sig.split(" ").map(s => s.replace(/^v1,/, ""));
  for (const s of sigs) {
    try {
      const a = Buffer.from(s, "base64");
      const b = Buffer.from(expected, "base64");
      if (a.length === b.length && timingSafeEqual(a, b)) return true;
    } catch { /* try next */ }
  }
  return false;
}

function extractEmail(to: string | string[] | undefined): string | null {
  if (!to) return null;
  const first = Array.isArray(to) ? to[0] : to;
  if (!first) return null;
  // Resend a veces incluye "Name <email@x.com>" — quedarse con el email
  const m = first.match(/<([^>]+)>/);
  return (m ? m[1] : first).trim().toLowerCase();
}

function mapTypeToStatus(eventType: string): "bounced" | "complained" | "delivery_delayed" | "delivered" | null {
  switch (eventType) {
    case "email.bounced":          return "bounced";
    case "email.complained":       return "complained";
    case "email.delivery_delayed": return "delivery_delayed";
    case "email.delivered":        return "delivered";
    default: return null;
  }
}

export async function POST(req: Request) {
  const rawBody = await req.text();

  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (secret && !verifySvixSignature(rawBody, req.headers, secret)) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  let event: ResendEvent;
  try {
    event = JSON.parse(rawBody) as ResendEvent;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const status = mapTypeToStatus(event.type);
  if (!status) {
    // Otros eventos (email.sent, email.opened, email.clicked) los ignoramos
    return NextResponse.json({ ok: true, ignored: event.type });
  }

  const email = extractEmail(event.data?.to);
  if (!email) {
    return NextResponse.json({ error: "no_recipient" }, { status: 400 });
  }

  const sb = supabaseAdmin();
  const nowIso = new Date().toISOString();

  // Buscar lead por email (case-insensitive)
  const { data: lead } = await sb
    .from("leads")
    .select("id, email_status")
    .ilike("email", email)
    .maybeSingle();

  // Solo persiste estados "duros" en leads.email_status (bounced/complained)
  // y soft (delivery_delayed). delivered se ignora para no sobreescribir
  // un bounce previo con un delivered de otro mensaje.
  const isHard = status === "bounced" || status === "complained";
  const isSoft = status === "delivery_delayed";

  if (lead && (isHard || isSoft)) {
    // No degradar de bounced/complained a delivery_delayed.
    const shouldUpdate = !lead.email_status
      || (isHard && lead.email_status !== "bounced" && lead.email_status !== "complained")
      || isHard;
    if (shouldUpdate) {
      await sb.from("leads").update({
        email_status:    status,
        email_status_at: nowIso,
      }).eq("id", lead.id);
    }
    await sb.from("lead_timeline").insert({
      lead_id: lead.id,
      type:    "send_failed",
      author:  "system",
      content: `📧 Resend webhook: ${status} (${event.type}) — ${email}`,
      metadata: {
        kind: "resend_webhook",
        channel: "email",
        resend_event: event.type,
        resend_email_id: event.data?.email_id ?? null,
        bounce: event.data?.bounce ?? null,
      },
    });
  } else if (!lead && isHard) {
    // Bounce/complaint de un email que no está en leads (puede ser
    // estudiante, profesor, admin). Loggear en stdout para visibilidad.
    console.warn(`[resend-webhook] ${status} para ${email} — no encontrado en leads`);
  }

  return NextResponse.json({ ok: true, processed: status, lead_id: lead?.id ?? null });
}

export async function GET() {
  return NextResponse.json({ ok: true, endpoint: "resend-webhook", time: new Date().toISOString() });
}
