import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * GET/POST /api/cron/wa-delivery-monitor — Gelfis 2026-11-27.
 *
 * Tras caso Rosa (+41794828810) en que TODOS los WA auto quedaron en
 * "Esperando el mensaje" en su móvil porque la sesión Signal se
 * desincronizó al reconectar V6: este cron detecta ese patrón para
 * actuar antes de que se acumulen.
 *
 * Ciclo (cada 5 min):
 *   1. Toma filas de wa_delivery_tracking con delivered_at=NULL,
 *      stuck_at=NULL, failed_at=NULL, sent_at ∈ [NOW-24h, NOW-3min].
 *   2. Para cada una, llama a Evolution `/chat/findMessages/{instance}`
 *      filtrando por key.id=<wa_message_id>.
 *   3. Interpreta status (Baileys):
 *        - 0/ERROR            → fallo irrecuperable (mantiene stuck=null,
 *                               marca failed_at)
 *        - 1/PENDING          → aún en cola local de Evolution
 *        - 2/SERVER_ACK       → sent OK al server WA (tilde gris)
 *        - 3/DELIVERY_ACK     → ENTREGADO (doble tilde gris)
 *        - 4/READ / 5/PLAYED  → leído
 *   4. Reglas:
 *        - status >= DELIVERY_ACK → delivered_at = now (fin)
 *        - sent_at > NOW-10min AND status < DELIVERY_ACK → stuck_at=now
 *          → el cron wa-delivery-recover lo retomará.
 *        - Caso sin encontrar el mensaje tras >10min → stuck_at (idem).
 *
 * MAX_PER_TICK alto (50) porque solo son GETs a Evolution — ligeros.
 *
 * Auth: Bearer CRON_SECRET.
 */

export const runtime  = "nodejs";
export const dynamic  = "force-dynamic";

const MAX_PER_TICK       = 50;
const MIN_WAIT_BEFORE_CHECK_MS = 3 * 60_000;        // 3 min
const STUCK_THRESHOLD_MS       = 10 * 60_000;       // 10 min
const LOOKBACK_MS              = 24 * 3600_000;     // 24h

type Row = {
  id: string;
  wa_message_id: string;
  phone_e164: string;
  instance: string;
  kind: string;
  sent_at: string;
  check_count: number;
  context: Record<string, unknown>;
};

type EvoMessage = {
  key?: { id?: string };
  status?: string | number;
};

type StatusTag = "PENDING" | "SERVER_ACK" | "DELIVERY_ACK" | "READ" | "PLAYED" | null;

function authorised(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const bearer = req.headers.get("authorization");
  if (bearer && bearer.toLowerCase().startsWith("bearer ") && bearer.slice(7).trim() === expected) return true;
  return req.headers.get("x-cron-secret") === expected;
}

/** Baileys serializa status unas veces como número (0..5) y otras como
 *  string. Devolvemos uno de los tags canónicos o null si no encaja. */
function parseStatus(raw: unknown): { tag: StatusTag; numeric: number } {
  if (raw == null) return { tag: null, numeric: -1 };
  const s = String(raw).toUpperCase();
  if (s === "0" || s === "ERROR")              return { tag: null, numeric: 0 };
  if (s === "1" || s === "PENDING")            return { tag: "PENDING", numeric: 1 };
  if (s === "2" || s === "SERVER_ACK")         return { tag: "SERVER_ACK", numeric: 2 };
  if (s === "3" || s === "DELIVERY_ACK")       return { tag: "DELIVERY_ACK", numeric: 3 };
  if (s === "4" || s === "READ")               return { tag: "READ", numeric: 4 };
  if (s === "5" || s === "PLAYED")             return { tag: "PLAYED", numeric: 5 };
  return { tag: null, numeric: -1 };
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
  const now = Date.now();
  const checkCutoff   = new Date(now - MIN_WAIT_BEFORE_CHECK_MS).toISOString();
  const lookbackFloor = new Date(now - LOOKBACK_MS).toISOString();

  const { data: rows, error } = await sb
    .from("wa_delivery_tracking")
    .select("id, wa_message_id, phone_e164, instance, kind, sent_at, check_count, context")
    .is("delivered_at", null)
    .is("stuck_at", null)
    .is("failed_at", null)
    .lt("sent_at", checkCutoff)
    .gt("sent_at", lookbackFloor)
    .order("sent_at", { ascending: true })
    .limit(MAX_PER_TICK);

  if (error) {
    return NextResponse.json({ error: "select_failed", detail: error.message }, { status: 500 });
  }

  const pending = (rows ?? []) as Row[];
  if (pending.length === 0) {
    return NextResponse.json({ ok: true, checked: 0, delivered: 0, stuck: 0 });
  }

  let delivered = 0;
  let stuck     = 0;
  let unknown   = 0;

  for (const r of pending) {
    const ageMs = now - new Date(r.sent_at).getTime();
    // Un POST /chat/findMessages/{instance} con filtro por key.id.
    // Evolution v1.8 acepta { where: { key: { id } } }.
    let evoStatus: StatusTag = null;
    let evoNumeric = -1;
    let evoFound   = false;
    try {
      const res = await fetch(`${evoUrl}/chat/findMessages/${encodeURIComponent(r.instance)}`, {
        method: "POST",
        headers: {
          "apikey":       evoKey,
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({ where: { key: { id: r.wa_message_id } } }),
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) {
        const body = await res.json().catch(() => null) as unknown;
        // findMessages devuelve array; si está vacío → no lo encontró.
        const arr = Array.isArray(body) ? body as EvoMessage[]
                  : Array.isArray((body as { messages?: EvoMessage[] })?.messages) ? (body as { messages: EvoMessage[] }).messages
                  : [];
        const match = arr.find((m) => m?.key?.id === r.wa_message_id) ?? arr[0];
        if (match) {
          evoFound = true;
          const parsed = parseStatus(match.status);
          evoStatus = parsed.tag;
          evoNumeric = parsed.numeric;
        }
      }
    } catch (e) {
      console.warn("[wa-delivery-monitor] findMessages failed:", r.wa_message_id, e instanceof Error ? e.message : e);
    }

    // Branches de actualización:
    // - Entregado (ack>=3) → delivered_at
    // - Muy viejo sin confirmación de entrega → stuck_at
    // - Normal → solo bump check_count + last_status
    const patch: Record<string, unknown> = {
      last_checked_at: new Date().toISOString(),
      check_count:     r.check_count + 1,
    };
    if (evoStatus) patch.last_status = evoStatus;

    if (evoFound && evoNumeric >= 3) {
      patch.delivered_at = new Date().toISOString();
      delivered++;
    } else if (ageMs >= STUCK_THRESHOLD_MS) {
      patch.stuck_at = new Date().toISOString();
      stuck++;
    } else {
      unknown++;
    }

    await sb.from("wa_delivery_tracking").update(patch).eq("id", r.id);
  }

  return NextResponse.json({
    ok: true,
    checked:   pending.length,
    delivered,
    stuck,
    unknown,
  });
}
