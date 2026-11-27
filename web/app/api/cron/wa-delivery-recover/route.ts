import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { sendWhatsappText } from "@/lib/whatsapp";
import { Resend } from "resend";

/**
 * GET/POST /api/cron/wa-delivery-recover — Gelfis 2026-11-27.
 *
 * Trabaja sobre filas de wa_delivery_tracking marcadas stuck_at por
 * wa-delivery-monitor. Un mensaje queda stuck cuando Evolution reporta
 * "sent al server" (ack 1/2) pero no "delivered al teléfono" (ack 3).
 * Síntoma típico: el destinatario ve "Esperando el mensaje..." porque
 * su sesión Signal con nuestro número no cierra el handshake (identity
 * key cambió al reconectar la instancia; su móvil rechaza y cachea).
 *
 * Dos fases por ejecución (cada 10 min):
 *
 *   A) Recovery activo (stuck sin recovery_attempted_at):
 *      - DELETE /chat/deleteSession/{instance} con el número → fuerza
 *        a Baileys a descartar la sesión Signal local y reconstruir
 *        PreKey+Identity la próxima vez que envíe.
 *      - Reenvío del texto original vía sendWhatsappText (misma kind,
 *        canal setter si así estaba; bypassDedup para no chocar con la
 *        Capa-1 anti-duplicados).
 *      - Marcamos recovery_attempted_at. El nuevo send también crea su
 *        propia fila de tracking (independiente) que el monitor seguirá.
 *
 *   B) Fallback manual (recovery ya intentado hace >15min y SIGUE sin
 *      delivered_at):
 *      - Insertamos agent_note kind=wa_manual_pending en lead_timeline
 *        (mismo formato que stashWaManualPendingIfCap) para que aparezca
 *        en el panel pending-manual y Gelfis lo envíe desde su WA.
 *      - Marcamos failed_at + email digest al admin (una vez por hora
 *        como máximo para no spam).
 *
 * Auth: Bearer CRON_SECRET.
 */

export const runtime  = "nodejs";
export const dynamic  = "force-dynamic";

const MAX_RECOVERY_PER_TICK = 20;
const FALLBACK_AFTER_MS     = 15 * 60_000;
const ALERT_EMAIL = process.env.NEW_LEAD_ALERT_EMAIL ?? "";
const RESEND_KEY  = process.env.RESEND_API_KEY ?? "";
const RESEND_FROM = process.env.RESEND_FROM_EMAIL ?? "no-reply@aprender-aleman.de";

type StuckRow = {
  id: string;
  lead_id: string | null;
  wa_message_id: string;
  phone_e164: string;
  instance: string;
  kind: string;
  original_text: string;
  sent_at: string;
  stuck_at: string;
  context: Record<string, unknown>;
};

function authorised(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const bearer = req.headers.get("authorization");
  if (bearer && bearer.toLowerCase().startsWith("bearer ") && bearer.slice(7).trim() === expected) return true;
  return req.headers.get("x-cron-secret") === expected;
}

/** Evolution Baileys: borra la sesión Signal con un JID. Tras esto, el
 *  próximo mensaje que enviemos arranca un handshake PreKey nuevo.
 *  Evolution v1.8 expone DELETE /chat/deleteMessageForEveryone y también
 *  POST /chat/deleteSession; usamos este último, con JID @s.whatsapp.net. */
async function resetSignalSession(evoUrl: string, evoKey: string, instance: string, phone: string): Promise<boolean> {
  const digits = phone.replace(/^\+/, "").replace(/\D/g, "");
  const jid = `${digits}@s.whatsapp.net`;
  try {
    const res = await fetch(`${evoUrl}/chat/deleteSession/${encodeURIComponent(instance)}`, {
      method: "POST",
      headers: {
        "apikey":       evoKey,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({ number: digits, jid }),
      signal: AbortSignal.timeout(15_000),
    });
    return res.ok;
  } catch (e) {
    console.warn("[wa-delivery-recover] deleteSession failed:", phone, e instanceof Error ? e.message : e);
    return false;
  }
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

  const evoUrl = process.env.EVOLUTION_API_URL?.replace(/\/$/, "");
  const evoKey = process.env.EVOLUTION_API_KEY;
  if (!evoUrl || !evoKey) {
    return NextResponse.json({ error: "evolution_env_missing" }, { status: 503 });
  }

  const sb = supabaseAdmin();
  const nowIso = new Date().toISOString();
  const fallbackCutoff = new Date(Date.now() - FALLBACK_AFTER_MS).toISOString();

  // ─── Fase A: recovery activo ──────────────────────────────────────────
  const { data: stuckRows, error: stuckErr } = await sb
    .from("wa_delivery_tracking")
    .select("id, lead_id, wa_message_id, phone_e164, instance, kind, original_text, sent_at, stuck_at, context")
    .not("stuck_at", "is", null)
    .is("recovery_attempted_at", null)
    .is("delivered_at", null)
    .is("failed_at", null)
    .order("stuck_at", { ascending: true })
    .limit(MAX_RECOVERY_PER_TICK);
  if (stuckErr) {
    return NextResponse.json({ error: "select_stuck_failed", detail: stuckErr.message }, { status: 500 });
  }

  let recoveryTried = 0;
  let recoveryOk    = 0;
  let recoveryFail  = 0;

  for (const r of (stuckRows ?? []) as StuckRow[]) {
    const sessionReset = await resetSignalSession(evoUrl, evoKey, r.instance, r.phone_e164);
    const channel = (r.context as { channel?: string } | null)?.channel === "setter" ? "setter" as const : undefined;

    const res = await sendWhatsappText(r.phone_e164, r.original_text, {
      kind: r.kind,
      ...(channel ? { channel } : {}),
      leadId: r.lead_id ?? undefined,
      bypassDedup: true,
    });

    await sb.from("wa_delivery_tracking").update({
      recovery_attempted_at: nowIso,
      recovery_action: `session_reset=${sessionReset ? "ok" : "fail"};resend=${res.ok ? "ok" : "fail"}`,
    }).eq("id", r.id);

    if (r.lead_id) {
      await sb.from("lead_timeline").insert({
        lead_id: r.lead_id,
        type:    res.ok ? "agent_note" : "send_failed",
        author:  "system",
        content: res.ok
          ? `🔄 WA ${r.kind} re-enviado tras reset de sesión Signal (destinatario veía "Esperando el mensaje")`
          : `🔄 WA ${r.kind} recovery falló: session_reset=${sessionReset ? "ok" : "fail"}, resend=${res.reason}`,
        metadata: {
          kind: "wa_delivery_recovery",
          original_kind: r.kind,
          wa_message_id: r.wa_message_id,
          session_reset: sessionReset,
          resend_ok: res.ok,
          resend_reason: res.ok ? undefined : res.reason,
        },
      }).then(() => {}, () => {});
    }

    recoveryTried++;
    if (res.ok) recoveryOk++; else recoveryFail++;
  }

  // ─── Fase B: fallback manual (recovery agotado) ───────────────────────
  const { data: fallbackRows, error: fbErr } = await sb
    .from("wa_delivery_tracking")
    .select("id, lead_id, wa_message_id, phone_e164, instance, kind, original_text, sent_at, stuck_at, recovery_attempted_at, context")
    .not("recovery_attempted_at", "is", null)
    .lt("recovery_attempted_at", fallbackCutoff)
    .is("delivered_at", null)
    .is("failed_at", null)
    .order("recovery_attempted_at", { ascending: true })
    .limit(MAX_RECOVERY_PER_TICK);
  if (fbErr) {
    return NextResponse.json({ error: "select_fallback_failed", detail: fbErr.message }, { status: 500 });
  }

  let fallbacks = 0;
  const fallbackLines: string[] = [];

  for (const r of (fallbackRows ?? []) as StuckRow[]) {
    const phoneNoPlus = r.phone_e164.replace(/^\+/, "");
    const waLink = `https://api.whatsapp.com/send?phone=${phoneNoPlus}&text=${encodeURIComponent(r.original_text)}`;

    if (r.lead_id) {
      // Dedup: no crear otro wa_manual_pending si ya hay uno pendiente
      // para este leadId + kind original.
      const existing = await sb
        .from("lead_timeline")
        .select("id")
        .eq("lead_id", r.lead_id)
        .eq("metadata->>kind", "wa_manual_pending")
        .eq("metadata->>original_kind", r.kind)
        .is("metadata->sent_manual_at", null)
        .gte("timestamp", new Date(Date.now() - 24 * 3600_000).toISOString())
        .limit(1);
      if ((existing.data?.length ?? 0) === 0) {
        await sb.from("lead_timeline").insert({
          lead_id: r.lead_id,
          type:    "agent_note",
          author:  "gelfis",
          content: `📋 WA ${r.kind} no entregado (sesión Signal stuck) — preparado para envío manual`,
          metadata: {
            kind: "wa_manual_pending",
            channel: "whatsapp",
            original_kind: r.kind,
            reason: "delivery_stuck",
            phone_e164: r.phone_e164,
            text: r.original_text,
            wa_link: waLink,
          },
        }).then(() => {}, () => {});
      }
    }

    await sb.from("wa_delivery_tracking").update({
      failed_at: nowIso,
      fail_reason: "delivery_stuck_after_recovery",
    }).eq("id", r.id);

    fallbacks++;
    fallbackLines.push(`  · ${r.phone_e164}  kind=${r.kind}  sent=${r.sent_at.slice(0, 16)}`);
  }

  // Alerta email agregada — max 1 por hora (dedupe simple vía heartbeat
  // en system_config). Si falla, no es crítico: ya están en el panel.
  if (fallbacks > 0 && ALERT_EMAIL && RESEND_KEY) {
    const lastKey = "wa_delivery_last_alert_at";
    const { data: cfg } = await sb.from("system_config").select("value").eq("key", lastKey).maybeSingle();
    const lastAt = ((cfg as { value?: string } | null)?.value) ?? "";
    const lastMs = lastAt ? Date.parse(lastAt) : 0;
    if (Number.isNaN(lastMs) || Date.now() - lastMs > 3600_000) {
      try {
        const lines = [
          `${fallbacks} mensajes WA no entregados (sesión Signal stuck tras recovery):`,
          "",
          ...fallbackLines,
          "",
          `Panel: /api/admin/wa/pending-manual`,
        ];
        const resend = new Resend(RESEND_KEY);
        await resend.emails.send({
          from:    RESEND_FROM,
          to:      ALERT_EMAIL,
          subject: `⚠️ ${fallbacks} WA no entregados — intervención manual`,
          text:    lines.join("\n"),
        });
        await sb.from("system_config").upsert({ key: lastKey, value: nowIso });
      } catch (e) {
        console.warn("[wa-delivery-recover] email alert failed:", e instanceof Error ? e.message : e);
      }
    }
  }

  return NextResponse.json({
    ok: true,
    recovery_tried: recoveryTried,
    recovery_ok:    recoveryOk,
    recovery_fail:  recoveryFail,
    fallbacks,
  });
}
