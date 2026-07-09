import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET/POST /api/cron/webhook-self-heal
 *
 * Cron cada 10 min. Garantiza que el webhook de la instancia activa de
 * Evolution apunta a la IP interna del VPS. Si Evolution regresa a la
 * URL pública (por auto-restart, cambios manuales en manager, etc.),
 * el hairpin NAT falla y los mensajes entrantes se pierden — Patricia
 * 2026-07-09: escribió "CANCELAR" y el webhook público nunca disparó.
 *
 * Lógica:
 *   1. Lee active_whatsapp_instance de system_config
 *   2. GET /webhook/find/{instance} en Evolution
 *   3. Si url actual != EVOLUTION_WEBHOOK_INTERNAL_URL → POST /webhook/set
 *   4. Loguea si detectó y corrigió desviación
 *
 * Auth: Bearer CRON_SECRET o X-Cron-Secret.
 */

const INTERNAL_WEBHOOK_URL = process.env.EVOLUTION_WEBHOOK_INTERNAL_URL
  ?? "http://10.0.1.5:8000/webhook/whatsapp";
const EVENTS = ["MESSAGES_UPSERT", "MESSAGES_UPDATE", "CONNECTION_UPDATE", "QRCODE_UPDATED"];

function authorised(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const bearer = req.headers.get("authorization");
  if (bearer && bearer.toLowerCase().startsWith("bearer ") && bearer.slice(7).trim() === expected) return true;
  return req.headers.get("x-cron-secret") === expected;
}

export async function GET(req: Request)  { return run(req); }
export async function POST(req: Request) { return run(req); }

async function run(req: Request) {
  if (!authorised(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const evoUrl = (process.env.EVOLUTION_API_URL ?? "").replace(/\/$/, "");
  const evoKey = process.env.EVOLUTION_API_KEY;
  if (!evoUrl || !evoKey) {
    return NextResponse.json({ error: "evolution_env_missing" }, { status: 503 });
  }

  const sb = supabaseAdmin();
  const { data: instRow } = await sb
    .from("system_config").select("value")
    .eq("key", "active_whatsapp_instance").maybeSingle();
  const instance = ((instRow as { value?: string } | null)?.value)
    ?? process.env.EVOLUTION_INSTANCE_MAIN ?? "aprender-aleman-main";

  // Fetch current webhook config
  let currentUrl: string | null = null;
  try {
    const res = await fetch(`${evoUrl}/webhook/find/${instance}`, {
      headers: { apikey: evoKey },
      signal: AbortSignal.timeout(8_000),
    });
    if (res.ok) {
      const data = await res.json().catch(() => ({} as Record<string, unknown>));
      currentUrl = ((data as { url?: string }).url) ?? null;
    } else if (res.status === 404) {
      return NextResponse.json({ ok: false, action: "instance_not_found", instance });
    }
  } catch (e) {
    return NextResponse.json({
      ok: false, action: "fetch_failed", instance,
      error: e instanceof Error ? e.message : "unknown",
    });
  }

  if (currentUrl === INTERNAL_WEBHOOK_URL) {
    return NextResponse.json({ ok: true, action: "no_change", instance, url: currentUrl });
  }

  // Fix
  try {
    const res = await fetch(`${evoUrl}/webhook/set/${instance}`, {
      method: "POST",
      headers: { apikey: evoKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled: true,
        url: INTERNAL_WEBHOOK_URL,
        webhookByEvents: false,
        webhookBase64: false,
        events: EVENTS,
      }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      return NextResponse.json({
        ok: false, action: "set_failed", instance,
        was: currentUrl, expected: INTERNAL_WEBHOOK_URL,
        http: res.status,
      }, { status: 502 });
    }
  } catch (e) {
    return NextResponse.json({
      ok: false, action: "set_exception", instance,
      error: e instanceof Error ? e.message : "unknown",
    }, { status: 502 });
  }

  // Log en system_config para auditoría de cuántas veces se ha ejecutado
  const now = new Date().toISOString();
  await sb.from("system_config").upsert([
    { key: "webhook_last_heal_at",  value: now },
    { key: "webhook_last_heal_from", value: currentUrl ?? "(unknown)" },
  ]);

  console.warn(
    `[webhook-self-heal] instance=${instance} was="${currentUrl}" → reseteado a ${INTERNAL_WEBHOOK_URL}`,
  );

  return NextResponse.json({
    ok: true, action: "healed", instance,
    was: currentUrl, now: INTERNAL_WEBHOOK_URL,
  });
}
