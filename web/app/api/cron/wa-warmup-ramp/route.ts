import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { createAdminNotification } from "@/lib/admin-notifications";

/**
 * GET/POST /api/cron/wa-warmup-ramp — Gelfis 2026-11-16
 *
 * Rampa automática del cap diario del número V6 en warm-up.
 * Lee `wa_warmup_started_at` y calcula cuántos días han pasado,
 * luego actualiza `wa_setter_daily_cap` + `wa_daily_send_cap` +
 * `wa_hourly_send_cap` según la tabla:
 *
 *   Día 1-3   → setter=10, daily=10, hourly=2
 *   Día 4-7   → setter=15, daily=15, hourly=3
 *   Día 8-14  → setter=25, daily=25, hourly=5
 *   Día 15-21 → setter=40, daily=40, hourly=8
 *   Día 22+   → setter=60, daily=60, hourly=12 (full)
 *
 * Si no hay `wa_warmup_started_at` o `wa_setter_instance` → no-op
 * (no hay warm-up activo).
 *
 * Idempotente: sólo escribe cuando el valor nuevo difiere del actual.
 * Notifica a Gelfis cada vez que sube un escalón.
 *
 * Schedule recomendado: 1x al día a las 00:15 Berlín (vercel.json).
 * Auth: Bearer CRON_SECRET o X-Cron-Secret.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STAGES: Array<{ fromDay: number; label: string; setter: number; daily: number; hourly: number }> = [
  { fromDay: 1,  label: "día 1-3 (ultra conservador)", setter: 10, daily: 10, hourly: 2 },
  { fromDay: 4,  label: "día 4-7 (suave)",             setter: 15, daily: 15, hourly: 3 },
  { fromDay: 8,  label: "día 8-14 (medio)",            setter: 25, daily: 25, hourly: 5 },
  { fromDay: 15, label: "día 15-21 (full warm)",       setter: 40, daily: 40, hourly: 8 },
  { fromDay: 22, label: "día 22+ (full régimen)",      setter: 60, daily: 60, hourly: 12 },
];

function stageFor(day: number): typeof STAGES[number] {
  let current = STAGES[0];
  for (const s of STAGES) if (day >= s.fromDay) current = s;
  return current;
}

function authorisedCronRequest(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const bearer = req.headers.get("authorization");
  if (bearer && bearer.toLowerCase().startsWith("bearer ") && bearer.slice(7).trim() === expected) return true;
  return req.headers.get("x-cron-secret") === expected;
}

export async function GET(req: Request)  { return run(req); }
export async function POST(req: Request) { return run(req); }

async function run(req: Request): Promise<Response> {
  if (!process.env.CRON_SECRET) return NextResponse.json({ error: "cron_not_configured" }, { status: 503 });
  if (!authorisedCronRequest(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sb = supabaseAdmin();
  const cfg = await sb
    .from("system_config")
    .select("key, value")
    .in("key", [
      "wa_warmup_started_at",
      "wa_setter_instance",
      "wa_setter_daily_cap",
      "wa_daily_send_cap",
      "wa_hourly_send_cap",
      "wa_warmup_day",
    ]);
  const kv = Object.fromEntries((cfg.data ?? []).map(r => [r.key, r.value])) as Record<string, string | undefined>;

  if (!kv.wa_warmup_started_at || !kv.wa_setter_instance) {
    return NextResponse.json({ ok: true, skipped: "no_active_warmup" });
  }

  const startedAt = new Date(kv.wa_warmup_started_at);
  if (isNaN(startedAt.getTime())) {
    return NextResponse.json({ error: "invalid_warmup_started_at", value: kv.wa_warmup_started_at }, { status: 500 });
  }

  const nowMs = Date.now();
  const daysElapsed = Math.max(1, Math.floor((nowMs - startedAt.getTime()) / 86_400_000) + 1);
  const stage = stageFor(daysElapsed);

  const current = {
    setter: Number(kv.wa_setter_daily_cap ?? 0),
    daily:  Number(kv.wa_daily_send_cap ?? 0),
    hourly: Number(kv.wa_hourly_send_cap ?? 0),
    day:    Number(kv.wa_warmup_day ?? 0),
  };

  const changes: Record<string, { from: number | string; to: number }> = {};
  const updates: Array<PromiseLike<unknown>> = [];

  async function setKey(key: string, newValue: string) {
    updates.push(sb.from("system_config").upsert({ key, value: newValue }));
  }

  if (current.setter !== stage.setter) {
    changes.wa_setter_daily_cap = { from: current.setter, to: stage.setter };
    await setKey("wa_setter_daily_cap", String(stage.setter));
  }
  if (current.daily !== stage.daily) {
    changes.wa_daily_send_cap = { from: current.daily, to: stage.daily };
    await setKey("wa_daily_send_cap", String(stage.daily));
  }
  if (current.hourly !== stage.hourly) {
    changes.wa_hourly_send_cap = { from: current.hourly, to: stage.hourly };
    await setKey("wa_hourly_send_cap", String(stage.hourly));
  }
  if (current.day !== daysElapsed) {
    changes.wa_warmup_day = { from: current.day, to: daysElapsed };
    await setKey("wa_warmup_day", String(daysElapsed));
  }

  await Promise.allSettled(updates.map(p => Promise.resolve(p)));

  // Notificar sólo si subió el escalón (cualquier cap aumentó).
  const scaleUp = Object.values(changes).some(ch =>
    typeof ch.from === "number" && typeof ch.to === "number" && ch.to > ch.from
  );
  if (scaleUp) {
    await createAdminNotification({
      type: "wa_warmup_ramp",
      severity: "info",
      title: `📈 Warm-up V6 subió al escalón: ${stage.label} (día ${daysElapsed})`,
      body: `Caps nuevos: setter=${stage.setter}/día · daily=${stage.daily}/día · hourly=${stage.hourly}/h. Monitorea fallos en /admin durante 24h — si hay bans o ratios malos, bajamos de nuevo.`,
      action_url: "/admin/system",
      metadata: { stage: stage.label, day: daysElapsed, changes },
      dedupeHours: 24,
    }).catch(err => console.warn("[warmup-ramp] notification failed:", err));
  }

  return NextResponse.json({
    ok: true,
    day: daysElapsed,
    stage: stage.label,
    caps_target: { setter: stage.setter, daily: stage.daily, hourly: stage.hourly },
    changes,
    scale_up: scaleUp,
  });
}
