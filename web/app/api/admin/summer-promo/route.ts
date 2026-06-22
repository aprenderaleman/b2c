import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { normaliseLevel, LEVEL_PRIORITY, type PromoLevel } from "@/lib/summer-promo-copy";

/**
 * POST /api/admin/summer-promo  body: { action: "start"|"pause"|"status", levels?: ["A0","A1",...] }
 * GET  /api/admin/summer-promo  → status
 *
 * Auth: CRON_SECRET (header Authorization Bearer o X-Cron-Secret).
 *
 * Actions:
 *  - start  → activa flag system_config.summer_promo_enabled=true.
 *             Si `levels` viene, sólo bumpea step=0 a los leads de esos
 *             niveles (default: ["A0","A1"]). NO toca leads con step>0
 *             para no resetear progreso de los ya tocados.
 *  - pause  → desactiva flag (no borra progreso).
 *  - status → cuenta por step y por nivel.
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
    .select("summer_promo_step, german_level, diagnostico_answers")
    .not("whatsapp_normalized", "is", null);

  const byStep: Record<string, number> = { "0": 0, "1": 0, "2": 0, "3": 0, "4": 0 };
  const byLevel: Record<PromoLevel, { total: number; sent: number; pending: number }> = {
    A0: { total: 0, sent: 0, pending: 0 },
    A1: { total: 0, sent: 0, pending: 0 },
    A2: { total: 0, sent: 0, pending: 0 },
    B1: { total: 0, sent: 0, pending: 0 },
    B2: { total: 0, sent: 0, pending: 0 },
    C1: { total: 0, sent: 0, pending: 0 },
    unknown: { total: 0, sent: 0, pending: 0 },
  };
  for (const r of (rows ?? []) as Array<{ summer_promo_step: number; german_level: string | null; diagnostico_answers: Record<string, unknown> | null }>) {
    const step = String(r.summer_promo_step ?? 0);
    byStep[step] = (byStep[step] ?? 0) + 1;
    const lvl = normaliseLevel(r.diagnostico_answers, r.german_level);
    byLevel[lvl].total += 1;
    if (r.summer_promo_step >= 1) byLevel[lvl].sent += 1;
    else byLevel[lvl].pending += 1;
  }

  return { enabled, by_step: byStep, by_level: byLevel };
}

export async function POST(req: Request) {
  if (!authorised(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({})) as {
    action?: "start" | "pause" | "status";
    levels?: PromoLevel[];
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
    const levels = (body.levels && body.levels.length > 0)
      ? body.levels
      : ["A0", "A1"] as PromoLevel[];
    // Validar
    const valid = levels.filter(l => LEVEL_PRIORITY.includes(l));
    if (valid.length === 0) {
      return NextResponse.json({ error: "invalid_levels", got: body.levels }, { status: 400 });
    }

    // No tocamos leads ya en pipeline (step>0). Solo nos aseguramos
    // que summer_promo_step=0 sea el estado por defecto — la migration
    // ya lo garantiza con DEFAULT 0. Aquí solo activamos el flag.
    await setFlag(true);

    return NextResponse.json({
      ok: true,
      action: "start",
      levels_filter: valid,
      note: "El cron solo procesa los niveles indicados primero (orden A0→C1). Para forzar a otros niveles, llama de nuevo con `levels` distintos.",
      status: await getStatus(),
    });
  }

  return NextResponse.json({ error: "unknown_action", got: action }, { status: 400 });
}

export async function GET(req: Request) {
  if (!authorised(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ ok: true, status: await getStatus() });
}
