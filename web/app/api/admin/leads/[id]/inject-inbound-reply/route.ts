import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { sendWhatsappText } from "@/lib/whatsapp";

/**
 * POST /api/admin/leads/[id]/inject-inbound-reply
 *
 * Recovery endpoint para cuando un inbound real del lead se perdio en
 * el matching @lid (caso Michelle/Tomas/Barbara 2026-06-16) y queremos
 * dejar trazas correctas en lead_timeline + responder a mano.
 *
 * Inserta:
 *   - lead_message_received con el texto que el lead dijo realmente
 *   - system_message_sent con la respuesta que mandamos
 *   - opcional: agent_note para anotar contexto
 *
 * Auth: CRON_SECRET.
 *
 * Body:
 *   {
 *     inbound_text:  string,           // lo que el lead dijo
 *     inbound_at?:   ISO timestamp,    // cuando lo dijo (default: NOW)
 *     reply_text:    string,           // respuesta que enviamos via WA
 *     note?:         string,           // agent_note opcional
 *     note_meta?:    Record<string, unknown>
 *   }
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

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!authorised(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => ({})) as {
    inbound_text?: string; inbound_at?: string; reply_text?: string;
    note?: string; note_meta?: Record<string, unknown>;
  };
  if (!body.reply_text) {
    return NextResponse.json({ error: "missing_fields", required: ["reply_text"] }, { status: 400 });
  }

  const sb = supabaseAdmin();
  const { data: lead } = await sb
    .from("leads")
    .select("id, whatsapp_normalized")
    .eq("id", id)
    .maybeSingle();
  if (!lead) return NextResponse.json({ error: "lead_not_found" }, { status: 404 });
  const l = lead as { id: string; whatsapp_normalized: string | null };
  if (!l.whatsapp_normalized) return NextResponse.json({ error: "no_whatsapp" }, { status: 400 });

  const inboundAt = body.inbound_at ?? new Date().toISOString();

  // 1) Inbound del lead — solo si nos lo pasaron (algunos casos como
  //    "reenvio confirmacion que se perdio" no tienen inbound real).
  if (body.inbound_text) {
    await sb.from("lead_timeline").insert({
      lead_id:   l.id,
      type:      "lead_message_received",
      author:    "lead",
      content:   body.inbound_text,
      timestamp: inboundAt,
      metadata:  { recovery: true, source: "manual_inject" },
    });
  }

  // 2) Agent note opcional
  if (body.note) {
    await sb.from("lead_timeline").insert({
      lead_id: l.id,
      type:    "agent_note",
      author:  "system",
      content: body.note,
      metadata: { recovery: true, ...(body.note_meta ?? {}) },
    });
  }

  // 3) Mandar respuesta WA
  const r = await sendWhatsappText(l.whatsapp_normalized, body.reply_text);
  if (!r.ok) {
    await sb.from("lead_timeline").insert({
      lead_id: l.id, type: "send_failed", author: "system",
      content: `💬 Inject reply failed: ${r.reason}`,
      metadata: { kind: "inject_inbound_reply", reason: r.reason },
    });
    return NextResponse.json({ ok: false, reason: r.reason, inbound_logged: true }, { status: 502 });
  }

  await sb.from("lead_timeline").insert({
    lead_id: l.id, type: "system_message_sent", author: "system",
    content: body.reply_text,
    metadata: { kind: "manual_recovery_reply", channel: "wa", message_id: r.messageId ?? null },
  });

  return NextResponse.json({ ok: true, messageId: r.messageId });
}
