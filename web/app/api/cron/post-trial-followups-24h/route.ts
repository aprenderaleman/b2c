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
    .select("id, lead_id, kind, reference_at, context, attempts")
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

  const MAX_ATTEMPTS = 5;
  let sent = 0, cancelled = 0, failed = 0, skipped = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] as Row & { attempts?: number };
    const currentAttempts = r.attempts ?? 0;
    if (currentAttempts >= MAX_ATTEMPTS) {
      await markCancelled(r.id, `max_attempts(${currentAttempts})`);
      cancelled++; continue;
    }
    // Lock atómico por versión: incrementamos attempts a (n+1) solo si
    // sigue siendo n. Si otro tick ya lo agarró, el UPDATE no retorna.
    const nextAttempts = currentAttempts + 1;
    const { data: locked } = await sb
      .from("post_trial_followups")
      .update({ attempts: nextAttempts, updated_at: new Date().toISOString() })
      .eq("id", r.id)
      .eq("attempts", currentAttempts)
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
      const reason = res.reason ?? "unknown";
      // Fallo permanente → cancel inmediato, no retry.
      const permanent = /^(no_whatsapp_on_lead|blocklisted|invalid_phone|exists.*false|whatsapp_disabled)/i.test(reason);
      if (permanent) {
        await markCancelled(r.id, `send_failed:${reason}`);
        cancelled++;
      } else {
        // Fallo transient (night_gate, caps, 503, duplicate…).
        // Mantenemos attempts incrementado (es el counter). El próximo
        // tick lee attempts=n+1 y vuelve a lockear n+1→n+2 hasta que
        // attempts >= MAX_ATTEMPTS, caso en el que se cancela arriba.
        await sb.from("post_trial_followups")
          .update({
            failed_at: new Date().toISOString(),
            last_error: reason,
            updated_at: new Date().toISOString(),
          })
          .eq("id", r.id);
        // Si es fallo por cap V6, stash el texto+link para envío manual.
        if (/^(setter_daily_cap|night_gate|hourly_cap|daily_cap)/.test(reason) && lead.whatsapp_normalized) {
          const phoneNoPlus = lead.whatsapp_normalized.replace(/^\+/, "");
          const waLink = `https://api.whatsapp.com/send?phone=${phoneNoPlus}&text=${encodeURIComponent(text)}`;
          await sb.from("lead_timeline").insert({
            lead_id: r.lead_id,
            type:    "agent_note",
            author:  "gelfis",
            content: `📋 WA +24h ${r.kind} auto bloqueado (${reason}) — preparado para envío manual`,
            metadata: {
              kind: "wa_manual_pending",
              channel: "whatsapp",
              original_kind: waKindFor(r.kind),
              phone: lead.whatsapp_normalized,
              text,
              wa_link: waLink,
              reason,
              followup_id: r.id,
            },
          }).then(() => {}, () => {});
        }
        failed++;
      }
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
