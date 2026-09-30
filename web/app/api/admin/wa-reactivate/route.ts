import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * POST /api/admin/wa-reactivate
 *
 * Reactiva WhatsApp tras un bloqueo/caída (Gelfis 2026-09-29 tras
 * v4 desconectada). Aplica en un solo shot:
 *
 *   1. Levanta el kill switch:        whatsapp_disabled = 'off'
 *   2. Inicia warm-up día 1:          wa_warmup_day = 1
 *                                     wa_warmup_started_at = NOW
 *   3. Baja el burst:                 wa_burst_cap_per_tick = 5
 *   4. Prioriza atascadas:            los chains fallidos en las
 *      últimas 24h reciben next_fire_at escalonado (attended/
 *      welcome/link cada 3 min desde NOW, rescate cada 5 min tras
 *      los attended). Esto evita ráfaga y prioriza leads que
 *      esperan respuesta post-compromiso.
 *
 * Auth: session admin/superadmin O CRON_SECRET (para curl manual).
 */

function isCronAuthd(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const bearer = req.headers.get("authorization");
  if (bearer && bearer.toLowerCase().startsWith("bearer ")) {
    if (bearer.slice(7).trim() === expected) return true;
  }
  return req.headers.get("x-cron-secret") === expected;
}

const ATTENDED_TYPES = new Set([
  "chain1_attended", "chain2_link_sent", "sesion_attended", "welcome_week",
]);

export async function POST(req: Request) {
  const cronAuthd = isCronAuthd(req);
  if (!cronAuthd) {
    const session = await auth();
    const role = (session?.user as { role?: string } | undefined)?.role;
    if (!session?.user || (role !== "admin" && role !== "superadmin")) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  }

  const sb = supabaseAdmin();
  const now = new Date();
  const nowIso = now.toISOString();

  // 1-3. Config
  const updates = [
    { key: "whatsapp_disabled",     value: "off"                 },
    { key: "wa_warmup_day",         value: "1"                   },
    { key: "wa_warmup_started_at",  value: nowIso                },
    { key: "wa_burst_cap_per_tick", value: "5"                   },
  ];
  for (const u of updates) {
    await sb.from("system_config")
      .upsert({ ...u, updated_at: nowIso }, { onConflict: "key" });
  }

  // 4. Chains atascadas: activas cuyo último intento falló en las
  //    últimas 24h (last_auto_sent_at null o pre-caída, con next_fire
  //    vencido). Espaciamos: attended cada 3min desde NOW, rescate
  //    empieza tras los últimos attended con gap 5min.
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 3_600_000).toISOString();
  const { data: pending } = await sb
    .from("lead_chains")
    .select("id, chain_type, next_fire_at")
    .is("completed_at", null)
    .lte("next_fire_at", nowIso)
    .gte("started_at", twentyFourHoursAgo)
    .order("chain_type", { ascending: true });

  const rows = (pending ?? []) as Array<{ id: string; chain_type: string; next_fire_at: string }>;
  const attended = rows.filter(r => ATTENDED_TYPES.has(r.chain_type));
  const rescue   = rows.filter(r => !ATTENDED_TYPES.has(r.chain_type));

  let scheduled = 0;
  const NOW_MS = now.getTime();
  for (let i = 0; i < attended.length; i++) {
    const fire = new Date(NOW_MS + i * 3 * 60_000).toISOString();
    await sb.from("lead_chains")
      .update({ next_fire_at: fire, updated_at: nowIso })
      .eq("id", attended[i].id);
    scheduled++;
  }
  const rescueStart = NOW_MS + attended.length * 3 * 60_000 + 5 * 60_000;
  for (let i = 0; i < rescue.length; i++) {
    const fire = new Date(rescueStart + i * 5 * 60_000).toISOString();
    await sb.from("lead_chains")
      .update({ next_fire_at: fire, updated_at: nowIso })
      .eq("id", rescue[i].id);
    scheduled++;
  }

  // Timeline audit (a nivel sistema — no ligado a un lead).
  try {
    await sb.from("lead_timeline").insert({
      lead_id: null,
      type:    "status_change",
      author:  "admin",
      content: `🟢 WhatsApp reactivado. Warm-up día 1 (cap 50), burst 5/tick. ` +
               `${attended.length} chains attended + ${rescue.length} rescate reprogramados.`,
      metadata: {
        kind: "wa_reactivated",
        warmup_day: 1,
        burst_cap: 5,
        attended_rescheduled: attended.length,
        rescue_rescheduled: rescue.length,
      },
    });
  } catch { /* audit best-effort */ }

  return NextResponse.json({
    ok: true,
    warmup_day: 1,
    burst_cap: 5,
    attended_rescheduled: attended.length,
    rescue_rescheduled: rescue.length,
    first_send_at: attended.length > 0 ? nowIso : new Date(rescueStart).toISOString(),
    last_send_at:  new Date(rescueStart + Math.max(0, rescue.length - 1) * 5 * 60_000).toISOString(),
  });
}
