import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * GET/POST /api/admin/summer-promo
 *   POST { action: "start" | "pause" } — flip flag system_config.summer_promo_enabled.
 *   GET → status (counts por step).
 *
 * Auth: CRON_SECRET.
 *
 * Nota: el cron tiene gate de MSG1_START_AT — si activas el flag antes
 * de la fecha de arranque calendario, el cron espera igualmente.
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

async function setFlag(value: boolean): Promise<void> {
  const sb = supabaseAdmin();
  await sb.from("system_config").upsert({
    key: "summer_promo_enabled",
    value: String(value),
    updated_at: new Date().toISOString(),
  });
}

async function getStatus(): Promise<Record<string, unknown>> {
  const sb = supabaseAdmin();
  const { data: cfg } = await sb.from("system_config").select("value")
    .eq("key", "summer_promo_enabled").maybeSingle();
  const rawVal = (cfg as { value?: unknown } | null)?.value;
  const enabled = rawVal === true || rawVal === "true" || rawVal === '"true"';

  // Conteo por step
  const { data: rows } = await sb
    .from("leads")
    .select("summer_promo_step")
    .not("whatsapp_normalized", "is", null);

  const byStep: Record<string, number> = { "0": 0, "1": 0, "2": 0, "3": 0, "4": 0 };
  for (const r of (rows ?? []) as Array<{ summer_promo_step: number }>) {
    const step = String(r.summer_promo_step ?? 0);
    byStep[step] = (byStep[step] ?? 0) + 1;
  }

  // Conteo eligible (mismo criterio que el cron)
  const { count: eligibleAll } = await sb.from("leads")
    .select("id", { count: "exact", head: true })
    .not("whatsapp_normalized", "is", null)
    .not("status", "in", '("converted","in_conversation","needs_human","trial_scheduled","trial_reminded")')
    .lt("summer_promo_step", 4);

  return { enabled, eligible_pool: eligibleAll ?? 0, by_step: byStep };
}

export async function POST(req: Request) {
  if (!authorised(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({})) as {
    action?: "start" | "pause" | "status";
  };
  const action = body.action ?? "status";

  if (action === "status") {
    return NextResponse.json({ ok: true, status: await getStatus() });
  }
  if (action === "pause") {
    await setFlag(false);
    return NextResponse.json({ ok: true, action: "pause", status: await getStatus() });
  }
  if (action === "start") {
    await setFlag(true);
    return NextResponse.json({
      ok: true,
      action: "start",
      note: "Flag activado. El cron solo dispara cuando NOW >= MSG1_START_AT (2026-06-20 06:00 UTC = 08:00 Berlin).",
      status: await getStatus(),
    });
  }
  return NextResponse.json({ error: "unknown_action", got: action }, { status: 400 });
}

export async function GET(req: Request) {
  if (!authorised(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ ok: true, status: await getStatus() });
}
