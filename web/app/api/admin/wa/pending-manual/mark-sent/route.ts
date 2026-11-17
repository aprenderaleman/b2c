import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * POST /api/admin/wa/pending-manual/mark-sent?secret=X
 * Body: { timeline_id, lead_id, kind }
 *
 * Marca el agent_note "wa_manual_pending" como enviado manualmente
 * (añade sent_manual_at al metadata) y registra un system_message_sent
 * para auditoría. Lo llama el botón "✓ Marcar enviado" del panel.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
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

  let body: { timeline_id?: string; lead_id?: string; kind?: string };
  try { body = (await req.json()) as typeof body; }
  catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }

  if (!body.timeline_id || !body.lead_id) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  const sb = supabaseAdmin();

  // Leer metadata actual + marcar sent
  const { data: row } = await sb
    .from("lead_timeline")
    .select("metadata")
    .eq("id", body.timeline_id)
    .maybeSingle();
  const prev = (row as { metadata?: Record<string, unknown> } | null)?.metadata ?? {};
  const merged = { ...prev, sent_manual_at: new Date().toISOString() };
  await sb.from("lead_timeline")
    .update({ metadata: merged })
    .eq("id", body.timeline_id);

  // Registrar envío
  await sb.from("lead_timeline").insert({
    lead_id: body.lead_id,
    type: "system_message_sent",
    author: "gelfis",
    content: `💬 Enviado manual por Gelfis desde WhatsApp Business (${body.kind ?? "wa"}) — cap V6 día ${new Date().toISOString().slice(0,10)}`,
    metadata: {
      kind: body.kind ?? "wa_manual_pending_sent",
      channel: "whatsapp",
      manual: true,
      actor: "gelfis",
      pending_id: body.timeline_id,
    },
  });

  return NextResponse.json({ ok: true });
}
