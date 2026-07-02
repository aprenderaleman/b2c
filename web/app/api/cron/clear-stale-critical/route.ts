import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET/POST /api/cron/clear-stale-critical
 *
 * Auto-clear del banner `last_critical_issue` cuando la alerta ya no
 * refleja la realidad. Corre cada 2 min desde Vercel.
 *
 * Caso disparador (2026-07-02): el janitor Python del VPS quedó
 * corriendo código viejo tras un auto-deploy fallido y sigue
 * escribiendo "Evolution API state='close'" aunque la instancia real
 * activa (v4) está open. Hasta que el VPS haga rebuild manual, este
 * cron limpia el banner comparándolo con Evolution directo.
 *
 * Heurísticas soportadas:
 *   1. Banner contiene "Evolution API state='close'" O "Connection Closed"
 *      → Consulta Evolution /instance/connectionState/{active} → si open,
 *      borra banner.
 *   2. Banner contiene "aprender-aleman-v2" o "-v3" (instancias viejas)
 *      → El caller usa instancia obsoleta. Borra banner (el envío real
 *      pasa por v4 desde el TS).
 *
 * Sin ninguna de esas condiciones → no toca nada.
 *
 * Auth: Bearer <CRON_SECRET> o X-Cron-Secret.
 */

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
  const sb = supabaseAdmin();

  const { data: bannerRow } = await sb
    .from("system_config")
    .select("value, updated_at")
    .eq("key", "last_critical_issue")
    .maybeSingle();
  const banner = ((bannerRow as { value?: string } | null)?.value ?? "").toString();
  if (!banner.trim()) {
    return NextResponse.json({ ok: true, action: "no_banner" });
  }

  const b = banner.toLowerCase();
  const isEvolutionCloseAlert =
    b.includes("evolution api state='close'") ||
    b.includes("connection closed") ||
    b.includes("state=\"close\"") ||
    b.includes("state=close") ||
    b.includes("probablemente whatsapp cerr");
  const referencesOldInstance =
    b.includes("aprender-aleman-v2") ||
    b.includes("aprender-aleman-v3") ||
    b.includes("aprender-aleman-main") && !b.includes("aprender-aleman-v4");

  if (!isEvolutionCloseAlert && !referencesOldInstance) {
    return NextResponse.json({ ok: true, action: "unrelated_banner", excerpt: banner.slice(0, 120) });
  }

  // Sanity check real: Evolution reporta state de la instancia activa
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

  let realState = "unknown";
  try {
    const res = await fetch(`${evoUrl}/instance/connectionState/${instance}`, {
      headers: { apikey: evoKey },
      signal: AbortSignal.timeout(8_000),
    });
    if (res.ok) {
      const data = await res.json().catch(() => ({} as Record<string, unknown>));
      realState = ((data as { instance?: { state?: string } }).instance?.state)
                ?? (data as { state?: string }).state ?? "unknown";
    }
  } catch { /* deja unknown */ }

  if (realState === "open") {
    // Realidad: v4 open. Banner obsoleto → borrar.
    await sb.from("system_config")
      .delete()
      .in("key", ["last_critical_issue", "last_critical_issue_at", "evolution_restart_tries"]);
    return NextResponse.json({
      ok: true, action: "banner_cleared",
      reason: "real_state_open_but_banner_says_close",
      instance, real_state: realState,
    });
  }

  return NextResponse.json({ ok: true, action: "kept", instance, real_state: realState });
}
