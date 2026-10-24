import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { sendRaw } from "@/lib/email/send";
import { buildUnsubscribeUrl, unsubscribeHeaders } from "@/lib/email-unsubscribe";

/**
 * POST /api/admin/campaign-email
 * body: { campaign: "reactivacion-2026-10", lead_id, subject, body_text }
 *
 * Envía UN email comercial personalizado a un lead (campañas de
 * reactivación, Gelfis 2026-10-24). El texto llega ya escrito y revisado;
 * aquí solo se maqueta, se añade el pie con enlace de baja + cabeceras
 * List-Unsubscribe (RFC 8058) y se registra en lead_timeline.
 *
 * Idempotente por (campaign, lead): si ya hay un envío OK de esa campaña
 * a ese lead, responde already_sent sin reenviar.
 * Suprime bounced/complained/unsubscribed (sendRaw marketing).
 *
 * Auth: Bearer CRON_SECRET o sesión admin/superadmin.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  campaign:  z.string().trim().min(3).max(60),
  lead_id:   z.string().uuid(),
  subject:   z.string().trim().min(3).max(150),
  body_text: z.string().trim().min(20).max(4000),
});

async function authorised(req: Request): Promise<boolean> {
  const expected = process.env.CRON_SECRET;
  const bearer = req.headers.get("authorization");
  if (expected && bearer?.toLowerCase().startsWith("bearer ") && bearer.slice(7).trim() === expected) return true;
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  return role === "admin" || role === "superadmin";
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Texto plano → HTML sobrio (párrafos + URLs clicables), con aspecto de email personal. */
function toHtml(body: string, unsubUrl: string): string {
  const paras = body.split(/\n{2,}/).map(p =>
    `<p style="margin:0 0 14px 0">${esc(p).replace(/\n/g, "<br>").replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#2563eb">$1</a>')}</p>`,
  ).join("");
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#ffffff">
<div style="max-width:560px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#1f2937">
${paras}
<p style="margin:28px 0 0 0;font-size:12px;color:#9ca3af">Aprender-Aleman.de · Si no quieres recibir más correos como este, <a href="${unsubUrl}" style="color:#9ca3af">date de baja aquí</a>.</p>
</div></body></html>`;
}

export async function POST(req: Request) {
  if (!(await authorised(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "validation_failed", issues: parsed.error.issues }, { status: 400 });
  const b = parsed.data;

  const sb = supabaseAdmin();
  const { data: lead } = await sb.from("leads").select("id, email").eq("id", b.lead_id).maybeSingle();
  if (!lead?.email) return NextResponse.json({ ok: false, reason: "no_email" }, { status: 404 });

  const { data: prev } = await sb.from("lead_timeline").select("id")
    .eq("lead_id", b.lead_id).eq("type", "system_message_sent")
    .filter("metadata->>kind", "eq", "campaign_email")
    .filter("metadata->>campaign", "eq", b.campaign).limit(1);
  if ((prev ?? []).length > 0) return NextResponse.json({ ok: true, reason: "already_sent" });

  const unsubUrl = buildUnsubscribeUrl(b.lead_id);
  const text = `${b.body_text}\n\n--\nAprender-Aleman.de · Darte de baja de estos correos: ${unsubUrl}`;
  const r = await sendRaw(lead.email, b.subject, toHtml(b.body_text, unsubUrl), text, undefined, {
    marketing: true, headers: unsubscribeHeaders(b.lead_id),
  });

  await sb.from("lead_timeline").insert({
    lead_id: b.lead_id,
    type:    r.ok ? "system_message_sent" : "send_failed",
    author:  "system",
    content: r.ok ? `[Email campaña ${b.campaign}] ${b.subject}\n\n${b.body_text}` : `📧 Falló email campaña ${b.campaign}: ${r.error}`,
    metadata: { channel: "email", kind: "campaign_email", campaign: b.campaign, sent_to: lead.email },
  });
  return NextResponse.json(r.ok ? { ok: true, id: r.id } : { ok: false, reason: r.error }, { status: r.ok ? 200 : 502 });
}
