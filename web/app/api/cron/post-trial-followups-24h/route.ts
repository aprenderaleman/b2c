import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { sendWhatsappText } from "@/lib/whatsapp";
import {
  buildFollowupText,
  leadRepliedSince,
  waKindFor,
  type FollowupKind,
} from "@/lib/post-trial-followups";

/**
 * GET/POST /api/cron/post-trial-followups-24h — Gelfis 2026-11-15
 *
 * Drena la tabla `post_trial_followups`: envía por WhatsApp los Msg 2
 * (+24h) de cada acción post-trial del profesor (asistio, no_asistio,
 * reagendar, enviar_enlace). Respeta:
 *
 *   - Ventana horaria (night gate 21-09 Berlin — gestionada por
 *     sendWhatsappText/whatsapp.ts).
 *   - Caps diario/horario del canal setter (también por whatsapp.ts).
 *   - Dedup inbound: si el lead respondió desde que creamos la fila,
 *     la cancelamos aquí mismo (nunca sale).
 *   - Dedup conversión: si el lead está converted, cancelamos.
 *
 * Batch: máximo 8 filas por tick; envíos espaciados 20 s entre sí
 * (además del gap de 15s built-in de sendWhatsappText) para suavizar.
 *
 * Auth: Bearer CRON_SECRET o X-Cron-Secret.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PER_TICK = 8;
const GAP_MS = 20_000;

function authorisedCronRequest(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const bearer = req.headers.get("authorization");
  if (bearer && bearer.toLowerCase().startsWith("bearer ") && bearer.slice(7).trim() === expected) return true;
  return req.headers.get("x-cron-secret") === expected;
}

export async function GET(req: Request)  { return run(req); }
export async function POST(req: Request) { return run(req); }

type Row = {
  id: string;
  lead_id: string;
  kind: FollowupKind;
  reference_at: string;
  context: Record<string, unknown>;
};

async function run(req: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "cron_not_configured" }, { status: 503 });
  }
  if (!authorisedCronRequest(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const sb = supabaseAdmin();
  const now = new Date().toISOString();

  const { data: rows, error } = await sb
    .from("post_trial_followups")
    .select("id, lead_id, kind, reference_at, context")
    .is("cancelled_at", null)
    .is("sent_at", null)
    .lte("due_at", now)
    .order("due_at", { ascending: true })
    .limit(MAX_PER_TICK);
  if (error) {
    return NextResponse.json({ error: "query_failed", reason: error.message }, { status: 500 });
  }
  if (!rows || rows.length === 0) {
    return NextResponse.json({ ok: true, processed: 0 });
  }

  let sent = 0, cancelled = 0, failed = 0, skipped = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] as Row;
    // Lock atómico: reservamos la fila marcando attempts++. Si otro tick
    // ya la agarró (por ejemplo tras un timeout), nos salimos.
    const { data: locked } = await sb
      .from("post_trial_followups")
      .update({ attempts: 1, updated_at: new Date().toISOString() })
      .eq("id", r.id)
      .eq("attempts", 0)
      .is("cancelled_at", null)
      .is("sent_at", null)
      .select("id")
      .maybeSingle();
    if (!locked) { skipped++; continue; }

    const { data: leadRow } = await sb
      .from("leads")
      .select("name, whatsapp_normalized, status, language, ai_paused_until")
      .eq("id", r.lead_id)
      .maybeSingle();
    const lead = leadRow as {
      name: string | null; whatsapp_normalized: string | null;
      status: string | null; language: "es" | "de" | null;
      ai_paused_until: string | null;
    } | null;

    if (!lead) {
      await markCancelled(r.id, "lead_not_found");
      cancelled++; continue;
    }
    if (lead.status === "converted") {
      await markCancelled(r.id, "lead_converted");
      cancelled++; continue;
    }
    if (lead.ai_paused_until && new Date(lead.ai_paused_until).getTime() > Date.now()) {
      await markCancelled(r.id, "ai_paused");
      cancelled++; continue;
    }
    if (await leadRepliedSince(r.lead_id, r.reference_at)) {
      await markCancelled(r.id, "lead_replied");
      cancelled++; continue;
    }
    if (!lead.whatsapp_normalized) {
      await markCancelled(r.id, "no_whatsapp");
      cancelled++; continue;
    }

    const firstName = (lead.name || "").split(/\s+/)[0] || "";
    const ctx = r.context ?? {};
    const text = buildFollowupText(r.kind, {
      firstName,
      rescheduleUrl: typeof ctx.rescheduleUrl === "string" ? ctx.rescheduleUrl : undefined,
      planUrl:       typeof ctx.planUrl === "string" ? ctx.planUrl : (typeof ctx.packLink === "string" ? ctx.packLink : undefined),
    });

    const res = await sendWhatsappText(lead.whatsapp_normalized, text, {
      kind: waKindFor(r.kind),
      channel: "setter",
    });

    if (res.ok) {
      await sb.from("post_trial_followups")
        .update({
          sent_at: new Date().toISOString(),
          message_id: res.messageId ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", r.id);
      await sb.from("lead_timeline").insert({
        lead_id: r.lead_id,
        type: "system_message_sent",
        author: "gelfis",
        content: `💬 Msg 2 (+24h) ${r.kind} enviado a ${lead.whatsapp_normalized}`,
        metadata: { kind: waKindFor(r.kind), channel: "whatsapp", followup_id: r.id },
      });
      sent++;
    } else {
      await sb.from("post_trial_followups")
        .update({
          failed_at: new Date().toISOString(),
          last_error: res.reason ?? "unknown",
          updated_at: new Date().toISOString(),
        })
        .eq("id", r.id);
      // Si el error es "soft" (night_gate, hourly_cap, daily_cap), limpiar
      // attempts para que el próximo tick lo reintente cuando se abra la
      // ventana. Dedup tope: no re-insertamos la fila si el lead luego
      // responde — la verificación corre arriba.
      const soft = /^(night_gate|hourly_cap|daily_cap|setter_daily_cap|recent_duplicate)/.test(res.reason ?? "");
      if (soft) {
        await sb.from("post_trial_followups")
          .update({ attempts: 0, failed_at: null })
          .eq("id", r.id);
      }
      failed++;
    }

    if (i < rows.length - 1) await new Promise(r => setTimeout(r, GAP_MS));
  }

  return NextResponse.json({ ok: true, processed: rows.length, sent, cancelled, failed, skipped });
}

async function markCancelled(id: string, reason: string): Promise<void> {
  const sb = supabaseAdmin();
  await sb.from("post_trial_followups")
    .update({
      cancelled_at: new Date().toISOString(),
      cancelled_reason: reason,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
}
