import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { pauseSystem, resumeSystem, getSystemPauseStatus } from "@/lib/system-pause";
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
const CIRCUIT_KEY     = "evolution_circuit_broken";
const FAIL_THRESHOLD  = 3;     // 3 ticks * 5 min = 15 min sin OK → pausa
const PAUSE_HOURS     = 24;    // Gelfis 2026-10-13: subido de 6h → 24h tras 2do ban preventivo en 14d

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

  // Si ya hay pausa global activa, NO hacemos early-return ciego — antes
  // de irnos, sondeamos Evolution. Si vuelve a estar 'open' y la pausa
  // fue puesta por este mismo health-monitor, la levantamos automaticamente.
  // Asi evitamos quedar pausados 6h por un hiccup de 30s del VPS (caso
  // Diana 2026-06-16: pausa 04:41 UTC, Evolution sano <1h despues, pero
  // sistema bloqueado hasta 10:41 → lead perdio confirmacion WA).
  const pauseStatus = await getSystemPauseStatus();
  const sb = supabaseAdmin();

  // Kill-switch del monitor mismo — sirve para operar en modo manual
  // cuando el auto-pausado auto-genera problemas (2026-07-02: VPS
  // Python quedó desincronizado con la instancia real; el monitor
  // veía v2 close y auto-pausaba 6h cada 15 min).
  {
    const { data: killRow } = await sb
      .from("system_config").select("value")
      .eq("key", "evolution_health_monitor_disabled").maybeSingle();
    const raw = (killRow as { value?: unknown } | null)?.value;
    if (raw === true || raw === "true" || raw === "1") {
      return NextResponse.json({ ok: true, skipped: "monitor_disabled" });
    }
  }

  // Circuit breaker: tras 2do ban preventivo en 14 días (29-09 v4 →
  // 12-10 v5), hipótesis que el poll cada 5 min contribuye a que
  // WhatsApp vea múltiples intentos de conexión y escale a ban. Una
  // vez que detectamos caída, DEJAMOS DE SONDEAR hasta que Gelfis
  // reconecte manualmente y resetee el flag desde `/admin/wa-reactivate`.
  // Mientras el flag esté activo, el cron hace NO-OP (ni siquiera
  // consulta Evolution ni modifica contadores).
  {
    const { data: cbRow } = await sb
      .from("system_config").select("value").eq("key", CIRCUIT_KEY).maybeSingle();
    const raw = (cbRow as { value?: unknown } | null)?.value;
    if (raw === true || raw === "true" || raw === "1") {
      return NextResponse.json({
        ok: true,
        skipped: "circuit_broken",
        message: "Evolution caída detectada previamente. Monitor en silencio hasta reconexión manual via /api/admin/wa-reactivate.",
      });
    }
  }

  // Consultamos Evolution DIRECTAMENTE (no via VPS Python). Antes
  // pasábamos por /internal/whatsapp-status del VPS, pero si el VPS
  // tiene la instancia desincronizada (env var vieja) el monitor veía
  // false-positive close y auto-pausaba el sistema por 6h. Al ir
  // directo a Evolution eliminamos ese punto de fallo. Instancia real:
  // system_config.active_whatsapp_instance (misma fuente que sender).
  const evoUrl = (process.env.EVOLUTION_API_URL ?? "").replace(/\/$/, "");
  const evoKey = process.env.EVOLUTION_API_KEY;
  if (!evoUrl || !evoKey) {
    return NextResponse.json({ error: "evolution_env_missing" }, { status: 503 });
  }
  const { data: instRow } = await sb
    .from("system_config").select("value")
    .eq("key", "active_whatsapp_instance").maybeSingle();
  const instance = ((instRow as { value?: string } | null)?.value)
    ?? process.env.EVOLUTION_INSTANCE_MAIN ?? "aprender-aleman-main";

  let state: string = "unknown";
  let reason: string | null = null;
  try {
    const res = await fetch(`${evoUrl}/instance/connectionState/${instance}`, {
      method: "GET",
      headers: { apikey: evoKey },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) {
      const data = await res.json().catch(() => ({} as Record<string, unknown>));
      state = ((data as { instance?: { state?: string } }).instance?.state)
           ?? (data as { state?: string }).state
           ?? "unknown";
    } else {
      reason = `http_${res.status}`;
    }
  } catch (e) {
    reason = e instanceof Error ? e.message : "fetch_failed";
  }

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
    // Auto-resume: si seguia pausado por este monitor (reason empieza
    // con 'health-monitor:'), lo levantamos y notificamos a Gelfis.
    if (pauseStatus.paused) {
      const wasHealthPause = (pauseStatus.reason ?? "").startsWith("health-monitor:");
      if (wasHealthPause) {
        await resumeSystem();
        await createAdminNotification({
          type: "system_resumed_auto",
          severity: "info",
          title: "Evolution recuperado — pausa global levantada",
          body: `El monitor detecto state='open'. Se reanudan envios automaticamente (antes la pausa esperaba al timestamp).`,
          action_url: "/admin/system",
          metadata: { previous_until: pauseStatus.until, previous_reason: pauseStatus.reason },
          dedupeHours: 1,
        });
        console.log(`[health-monitor] AUTO-RESUME — Evolution sano, levantada pausa que iba hasta ${pauseStatus.until}`);
        return NextResponse.json({ ok: true, state, fail_count: 0, action: "AUTO_RESUMED" });
      }
      // Pausa puesta manualmente o por otro origen → no la tocamos.
      return NextResponse.json({ ok: true, state, fail_count: 0, skipped_reason: "manual_pause_active", until: pauseStatus.until });
    }
    return NextResponse.json({ ok: true, state, fail_count: 0 });
  }

  // No-OK y ya hay pausa activa → no acumular contador ni notificar de nuevo.
  if (pauseStatus.paused) {
    return NextResponse.json({ ok: true, state, fail_count: failCount, skipped_reason: "already_paused", until: pauseStatus.until });
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

  // Umbral alcanzado → activar pausa global, ARMAR CIRCUIT BREAKER y notificar.
  if (newCount >= FAIL_THRESHOLD) {
    await pauseSystem(
      PAUSE_HOURS,
      `health-monitor: Evolution state='${state}' x${newCount} (reason: ${reason ?? "n/a"})`,
    );
    // Reset contador después de activar pausa.
    await sb.from("system_config").upsert({ key: HEALTH_FAIL_KEY, value: "0" });

    // Armar circuit breaker: a partir de este momento, el monitor
    // deja de sondear Evolution hasta que Gelfis reconecte manualmente
    // y llame /api/admin/wa-reactivate. Hipótesis Gelfis 2026-10-13:
    // los sondeos cada 5 min durante la caída contribuyen al ban
    // preventivo porque WhatsApp los interpreta como login attempts
    // (fue el 2do ban en 14 días: v4 el 29-09, v5 el 12-10).
    await sb.from("system_config").upsert({ key: CIRCUIT_KEY, value: "true" });

    // Notificación in-app — el bell del header parpadea + dropdown
    // muestra la alerta con link a /admin/system. dedup: 6h.
    await createAdminNotification({
      type: "system_paused_auto",
      severity: "critical",
      title: `🚨 Evolution caído — pausa ${PAUSE_HOURS}h + circuit breaker ARMADO`,
      body: `El monitor detectó Evolution state='${state}' durante ${newCount} chequeos seguidos (~${newCount * 5} min). ${reason ?? ""}

Para evitar un tercer ban preventivo, el monitor ha PARADO los sondeos automáticos.
Pasos para reactivar:
  1. Verifica si WhatsApp te deja re-vincular (web.whatsapp.com → QR).
  2. Si sí → reconecta en Evolution manager.
  3. Llama POST /api/admin/wa-reactivate — levanta pausa, resetea circuit breaker,
     warm-up día 1.`.trim(),
      action_url: "/admin/system",
      metadata: { state, fail_count: newCount, reason, paused_for_hours: PAUSE_HOURS, circuit_broken: true },
      dedupeHours: 6,
    });
    console.error(`[health-monitor] PAUSA AUTOMATICA + CIRCUIT BREAKER — Evolution state=${state} x${newCount}, paused ${PAUSE_HOURS}h`);

    return NextResponse.json({
      ok: true,
      state,
      fail_count: newCount,
      action: "AUTO_PAUSED_CIRCUIT_BROKEN",
      reason,
      paused_for_hours: PAUSE_HOURS,
      circuit_broken: true,
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
