import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { pauseSystem, getSystemPauseStatus } from "@/lib/system-pause";
import { createAdminNotification } from "@/lib/admin-notifications";

/**
 * GET/POST /api/cron/evolution-health
 *
 * Salud proactiva de Evolution. Cada 5 min (cron Vercel) checkea el
 * estado de la sesión WhatsApp:
 *   - Si state == 'open' → contador de fallos consecutivos a 0
 *   - Si state != 'open' o no responde → contador +1
 *   - Si contador >= 3 (≈ 15 min sin estar OK) → activa pausa global
 *     de 6h + notifica a Gelfis
 *
 * El contador se persiste en system_config (key='evolution_health_fail_count').
 *
 * Por qué este monitor en TS y no en Python:
 *   - Ya hay auto-pause en webhook_server.py al detectar errores de send,
 *     pero solo se dispara EN UN INTENTO DE ENVÍO. Si el sistema está
 *     idle (de noche, fuera de horario), Evolution puede caer sin alerta
 *     durante horas. Este cron es proactivo independientemente del tráfico.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEALTH_FAIL_KEY = "evolution_health_fail_count";
const FAIL_THRESHOLD  = 3;     // 3 ticks * 5 min = 15 min sin OK → pausa
const PAUSE_HOURS     = 6;

function authorised(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const bearer = req.headers.get("authorization");
  if (bearer && bearer.toLowerCase().startsWith("bearer ") && bearer.slice(7).trim() === expected) return true;
  return req.headers.get("x-cron-secret") === expected;
}

async function run(req: Request) {
  if (!authorised(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Si ya hay pausa global activa, no escalar más — Gelfis está al tanto.
  const pauseStatus = await getSystemPauseStatus();
  if (pauseStatus.paused) {
    return NextResponse.json({ ok: true, skipped_reason: "already_paused", until: pauseStatus.until });
  }

  // Consultamos el state vía el agents server (mismo endpoint que usa /admin/system).
  // Si Evolution responde 'open' → todo bien. Si no o timeout → contar fallo.
  const agentsBase = (process.env.AGENTS_BASE_URL ?? "").replace(/\/$/, "");
  const secret     = process.env.AGENTS_INTERNAL_SECRET;
  if (!agentsBase || !secret) {
    return NextResponse.json({ error: "agents_env_missing" }, { status: 503 });
  }

  let state: string = "unknown";
  let reason: string | null = null;
  try {
    const res = await fetch(`${agentsBase}/internal/whatsapp-status`, {
      method: "GET",
      headers: { "X-Internal-Secret": secret },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) {
      const data = await res.json().catch(() => ({} as Record<string, unknown>));
      state = (data as { state?: string }).state ?? "unknown";
    } else {
      reason = `http_${res.status}`;
    }
  } catch (e) {
    reason = e instanceof Error ? e.message : "fetch_failed";
  }

  const sb = supabaseAdmin();
  const { data: curRow } = await sb
    .from("system_config")
    .select("value")
    .eq("key", HEALTH_FAIL_KEY)
    .maybeSingle();
  const failCount = Number((curRow as { value?: string } | null)?.value ?? "0") || 0;

  if (state === "open") {
    // Salud OK. Reset contador si no estaba ya en 0.
    if (failCount !== 0) {
      await sb.from("system_config").upsert({ key: HEALTH_FAIL_KEY, value: "0" });
    }
    return NextResponse.json({ ok: true, state, fail_count: 0 });
  }

  // No-OK → incrementar contador.
  const newCount = failCount + 1;
  await sb.from("system_config").upsert({ key: HEALTH_FAIL_KEY, value: String(newCount) });
  // Marcar el inicio del downtime para que el recovery posterior sepa
  // desde cuándo buscar mensajes perdidos. Solo se setea la PRIMERA vez
  // (cuando failCount pasa de 0 a 1).
  if (failCount === 0) {
    await sb.from("system_config").upsert({
      key: "evolution_was_down_at",
      value: new Date().toISOString(),
    });
  }

  // Umbral alcanzado → activar pausa global y notificar.
  if (newCount >= FAIL_THRESHOLD) {
    await pauseSystem(
      PAUSE_HOURS,
      `health-monitor: Evolution state='${state}' x${newCount} (reason: ${reason ?? "n/a"})`,
    );
    // Reset contador después de activar pausa.
    await sb.from("system_config").upsert({ key: HEALTH_FAIL_KEY, value: "0" });

    // Notificación in-app — el bell del header parpadea + dropdown
    // muestra la alerta con link a /admin/system. dedup: 6h (evitar
    // re-disparar si el monitor sigue detectando el mismo problema).
    await createAdminNotification({
      type: "system_paused_auto",
      severity: "critical",
      title: `🚨 Evolution caído — pausa automática ${PAUSE_HOURS}h activada`,
      body: `El monitor detectó Evolution state='${state}' durante ${newCount} chequeos seguidos (~${newCount * 5} min). ${reason ?? ""}`.trim(),
      action_url: "/admin/system",
      metadata: { state, fail_count: newCount, reason, paused_for_hours: PAUSE_HOURS },
      dedupeHours: 6,
    });
    console.error(`[health-monitor] PAUSA AUTOMATICA — Evolution state=${state} x${newCount}, paused ${PAUSE_HOURS}h`);

    return NextResponse.json({
      ok: true,
      state,
      fail_count: newCount,
      action: "AUTO_PAUSED",
      reason,
      paused_for_hours: PAUSE_HOURS,
    });
  }

  return NextResponse.json({
    ok: true,
    state,
    fail_count: newCount,
    threshold: FAIL_THRESHOLD,
    reason,
  });
}

export async function GET(req: Request)  { return run(req); }
export async function POST(req: Request) { return run(req); }
