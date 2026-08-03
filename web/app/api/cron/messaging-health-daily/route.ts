import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getSystemPauseStatus, resumeSystem } from "@/lib/system-pause";
import { createAdminNotification } from "@/lib/admin-notifications";

/**
 * GET/POST /api/cron/messaging-health-daily
 *
 * Auditoría diaria del sistema de mensajes (Gelfis 2026-06-17).
 * Schedule en vercel.json: `0 6 * * *` (= 08:00 Berlín en CEST verano,
 * 07:00 en CET invierno; aceptamos 1h offset entre estaciones).
 *
 * Para cada componente:
 *   - Chequea estado real (no asume).
 *   - Auto-arregla lo que puede (caso típico: pausa global puesta por
 *     health-monitor con Evolution ya recuperado → resumeSystem()).
 *   - Recolecta el resultado.
 *
 * Al final crea UNA notificación in-app:
 *   - severity="info" + título "✅ Todo OK" si 0 problemas.
 *   - severity="high" + título "⚠️ N problemas detectados" si hay alguno.
 *   - El body lista cada componente con su estado + auto-fixes aplicados.
 *
 * dedupeHours=20 → si Gelfis no leyó la anterior, no duplicamos (cubre
 * el caso de re-trigger manual desde /admin/system o reintento de cron).
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

type CheckResult = {
  name:    string;
  ok:      boolean;
  detail:  string;
  fixed?:  boolean;
  level?:  "critical" | "warning" | "info";
};

async function run(req: Request) {
  if (!authorised(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const sb = supabaseAdmin();
  const results: CheckResult[] = [];

  // ── 1. Webhook FastAPI VPS ─────────────────────────────────────
  try {
    const url = (process.env.AGENTS_BASE_URL ?? "").replace(/\/$/, "");
    if (!url) {
      results.push({ name: "Webhook FastAPI", ok: false, level: "critical",
        detail: "AGENTS_BASE_URL no configurado" });
    } else {
      const res = await fetch(`${url}/healthz`, { signal: AbortSignal.timeout(8_000) });
      const ok = res.ok;
      results.push({ name: "Webhook FastAPI", ok, level: ok ? "info" : "critical",
        detail: ok ? "healthz ok" : `HTTP ${res.status}` });
    }
  } catch (e) {
    results.push({ name: "Webhook FastAPI", ok: false, level: "critical",
      detail: e instanceof Error ? e.message : "fetch failed" });
  }

  // ── 2. Pausa global (con auto-fix si Evolution OK) ─────────────
  let pauseFixed = false;
  try {
    const pause = await getSystemPauseStatus();
    if (pause.paused) {
      const evoUrl = (process.env.AGENTS_BASE_URL ?? "").replace(/\/$/, "");
      const evoSec = process.env.AGENTS_INTERNAL_SECRET;
      let evoOpen = false;
      if (evoUrl && evoSec) {
        try {
          const r = await fetch(`${evoUrl}/internal/whatsapp-status`, {
            headers: { "X-Internal-Secret": evoSec },
            signal: AbortSignal.timeout(10_000),
          });
          if (r.ok) {
            const d = await r.json().catch(() => ({} as Record<string, unknown>));
            evoOpen = (d as { state?: string }).state === "open";
          }
        } catch { /* keep evoOpen=false */ }
      }
      const wasHealthPause = (pause.reason ?? "").startsWith("health-monitor:");
      if (evoOpen && wasHealthPause) {
        await resumeSystem();
        pauseFixed = true;
        results.push({ name: "Pausa global", ok: true, fixed: true, level: "warning",
          detail: `Auto-resumed: estaba pausado hasta ${pause.until} por health-monitor, Evolution ya está open` });
      } else {
        results.push({ name: "Pausa global", ok: false, level: "critical",
          detail: `Activa hasta ${pause.until}. Razón: ${pause.reason}. Evolution open=${evoOpen}` });
      }
    } else {
      results.push({ name: "Pausa global", ok: true, level: "info", detail: "sin pausa" });
    }
  } catch (e) {
    results.push({ name: "Pausa global", ok: false, level: "warning",
      detail: e instanceof Error ? e.message : "check failed" });
  }

  // ── 3. Evolution health fail_count ─────────────────────────────
  try {
    const { data } = await sb.from("system_config").select("value")
      .eq("key", "evolution_health_fail_count").maybeSingle();
    const fc = Number(String((data as { value?: string } | null)?.value ?? "0").replace(/"/g, "")) || 0;
    const ok = fc < 3;
    results.push({ name: "Evolution health", ok, level: ok ? "info" : "warning",
      detail: `fail_count=${fc}${ok ? "" : " (proximo a pausa automatica)"}` });
  } catch (e) {
    results.push({ name: "Evolution health", ok: false, level: "warning",
      detail: e instanceof Error ? e.message : "n/a" });
  }

  // ── 4. Migraciones críticas (columnas) ─────────────────────────
  // Una SELECT vacía es suficiente — si alguna columna falta PostgREST
  // devuelve un error 400 con el nombre de la columna ausente.
  try {
    const { error } = await sb.from("leads")
      .select("meta, trial_confirmed_at, trial_attended_at, trial_absent_at")
      .limit(0);
    if (error) throw new Error(error.message);
    results.push({ name: "Migraciones (leads.meta/...)", ok: true, level: "info",
      detail: "todas las columnas críticas existen" });
  } catch (e) {
    results.push({ name: "Migraciones (leads.meta/...)", ok: false, level: "critical",
      detail: e instanceof Error ? e.message.slice(0, 150) : "check failed" });
  }

  // ── 5. Scheduler Python: inbound_dedup recibe ─────────────────
  try {
    const { data } = await sb.from("inbound_dedup").select("received_at")
      .gte("received_at", new Date(Date.now() - 2 * 3600_000).toISOString())
      .limit(1);
    const ok = (data?.length ?? 0) > 0;
    results.push({ name: "Scheduler Python (inbounds 2h)", ok, level: ok ? "info" : "warning",
      detail: ok ? "procesa inbounds" : "sin actividad — posible scheduler caído O sin tráfico real" });
  } catch (e) {
    results.push({ name: "Scheduler Python", ok: false, level: "warning",
      detail: e instanceof Error ? e.message : "check failed" });
  }

  // ── 6. Motor lead_chains — reemplaza al desaparecido cron
  //       post-trial-followups (chain1_attended lo cubre desde 2026-08-01).
  try {
    const { data, error } = await sb.from("lead_chains").select("id, chain_type, next_fire_at")
      .is("completed_at", null)
      .lte("next_fire_at", new Date().toISOString())
      .limit(5);
    if (error) throw new Error(error.message);
    const pending = data?.length ?? 0;
    // Solo alertar si hay muchas chains pendientes acumuladas (procesador atascado).
    const level = pending >= 5 ? "warning" : "info";
    results.push({ name: "Motor lead_chains", ok: pending < 5, level,
      detail: `${pending} cadenas pendientes de disparar` });
  } catch (e) {
    results.push({ name: "Motor lead_chains", ok: false, level: "critical",
      detail: e instanceof Error ? e.message : "query failed" });
  }

  // ── 7. outbound_queue sin mensajes stuck ──────────────────────
  try {
    const { count } = await sb.from("outbound_queue")
      .select("id", { count: "exact", head: true })
      .in("status", ["queued", "failed_transient"]);
    const stuck = count ?? 0;
    const ok = stuck < 5;
    results.push({ name: "outbound_queue", ok, level: ok ? "info" : "warning",
      detail: ok ? `${stuck} pendientes` : `${stuck} mensajes stuck` });
  } catch (e) {
    results.push({ name: "outbound_queue", ok: false, level: "warning",
      detail: e instanceof Error ? e.message : "check failed" });
  }

  // ── 8. Mensajes UTF-8 corruptos en últimas 24h ───────────────
  try {
    const { count } = await sb.from("lead_timeline")
      .select("id", { count: "exact", head: true })
      .eq("type", "system_message_sent")
      .gte("timestamp", new Date(Date.now() - 24 * 3600_000).toISOString())
      .like("content", `%${String.fromCharCode(65533)}%`);
    const n = count ?? 0;
    // <3 tolerable porque hay 3 legacy de 2026-06-17 que no se pueden borrar sin perder histórico
    const ok = n <= 3;
    results.push({ name: "Mensajes UTF-8 OK 24h", ok, level: ok ? "info" : "warning",
      detail: ok ? `${n} corruptos (≤3 legacy aceptable)` : `${n} mensajes con replacement char — investigar` });
  } catch (e) {
    results.push({ name: "UTF-8 check", ok: false, level: "warning",
      detail: e instanceof Error ? e.message : "check failed" });
  }

  // ── 9. Actividad outbound 24h (señal de vida) ─────────────────
  try {
    const { count } = await sb.from("lead_timeline")
      .select("id", { count: "exact", head: true })
      .eq("type", "system_message_sent")
      .gte("timestamp", new Date(Date.now() - 24 * 3600_000).toISOString());
    const n = count ?? 0;
    const ok = n > 0;
    results.push({ name: "Actividad outbound 24h", ok, level: ok ? "info" : "warning",
      detail: `${n} mensajes salientes${ok ? "" : " — sospechoso, ¿stuck?"}` });
  } catch (e) {
    results.push({ name: "Actividad outbound", ok: false, level: "warning",
      detail: e instanceof Error ? e.message : "check failed" });
  }

  // ── 10. send_failed recientes (>3 = problema) ─────────────────
  try {
    const { count } = await sb.from("lead_timeline")
      .select("id", { count: "exact", head: true })
      .eq("type", "send_failed")
      .gte("timestamp", new Date(Date.now() - 24 * 3600_000).toISOString());
    const n = count ?? 0;
    const ok = n < 5;
    results.push({ name: "send_failed 24h", ok, level: ok ? "info" : "warning",
      detail: ok ? `${n} fallos` : `${n} fallos — revisar logs` });
  } catch (e) {
    results.push({ name: "send_failed check", ok: false, level: "warning",
      detail: e instanceof Error ? e.message : "check failed" });
  }

  // ── 11. NEW_LEAD_ALERT vars activas (config crítica) ──────────
  const alertEnabled = (process.env.NEW_LEAD_ALERT_ENABLED ?? "false") === "true";
  const alertEmail   = (process.env.NEW_LEAD_ALERT_EMAIL ?? "").trim();
  results.push({ name: "Alertas nuevo lead",
    ok: alertEnabled && alertEmail.length > 0,
    level: alertEnabled && alertEmail.length > 0 ? "info" : "warning",
    detail: alertEnabled ? `→ ${alertEmail}` : "DESACTIVADAS" });

  // ── Compilar reporte ──────────────────────────────────────────
  const failures = results.filter(r => !r.ok);
  const criticals = failures.filter(r => r.level === "critical");
  const warnings  = failures.filter(r => r.level === "warning");
  const fixes     = results.filter(r => r.fixed);

  const fmt = (r: CheckResult) => {
    const icon = r.fixed ? "🔧" : r.ok ? "✅" : (r.level === "critical" ? "🔴" : "⚠️");
    return `${icon} ${r.name} — ${r.detail}`;
  };

  let title: string;
  let severity: "info" | "warning" | "high" | "critical";
  if (criticals.length > 0) {
    title = `🚨 Sistema de mensajes — ${criticals.length} crítico${criticals.length > 1 ? "s" : ""}, ${warnings.length} aviso${warnings.length !== 1 ? "s" : ""}`;
    severity = "critical";
  } else if (warnings.length > 0) {
    title = `⚠️ Sistema de mensajes — ${warnings.length} aviso${warnings.length > 1 ? "s" : ""}${fixes.length > 0 ? ` (${fixes.length} auto-arreglado${fixes.length > 1 ? "s" : ""})` : ""}`;
    severity = "warning";
  } else {
    title = `✅ Sistema de mensajes — todo OK${fixes.length > 0 ? ` (${fixes.length} auto-arreglado${fixes.length > 1 ? "s" : ""})` : ""}`;
    severity = "info";
  }

  const body = [
    `Auditoria diaria — ${results.length} componentes chequeados.`,
    "",
    ...results.map(fmt),
    "",
    `Resumen: ${results.length - failures.length}/${results.length} OK`,
    fixes.length > 0 ? `Auto-fix: ${fixes.length} aplicado${fixes.length > 1 ? "s" : ""}.` : "",
  ].filter(Boolean).join("\n");

  await createAdminNotification({
    type:        "messaging_health_daily",
    severity,
    title,
    body,
    action_url:  "/admin/system",
    metadata:    { results, fixes_count: fixes.length, pause_fixed: pauseFixed },
    dedupeHours: 20,
  });

  return NextResponse.json({
    ok:        true,
    checked:   results.length,
    passed:    results.length - failures.length,
    criticals: criticals.length,
    warnings:  warnings.length,
    fixes:     fixes.length,
    results,
  });
}

export async function GET(req: Request)  { return run(req); }
export async function POST(req: Request) { return run(req); }
