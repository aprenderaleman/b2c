import { NextResponse } from "next/server";

/**
 * POST /api/cron/evolution-webhook-sync?instance=X — herramienta de
 * operación (Gelfis 2026-10-27). Lee la config de webhook de UNA
 * instancia de Evolution (no necesariamente la activa) y, si no apunta
 * a la URL buena con los eventos correctos, la corrige.
 *
 * Nace del caso v6: el webhook configurado a mano en el manager no
 * disparaba y desde fuera no podíamos ver qué había guardado (la API
 * key de Evolution solo vive en Vercel y el VPS). Auth: CRON_SECRET.
 *
 * Devuelve { before, after } con la config leída/aplicada — sin secretos.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WEBHOOK_URL = process.env.EVOLUTION_WEBHOOK_INTERNAL_URL
  ?? "https://agents.aprender-aleman.de/webhook/whatsapp";
const EVENTS = ["MESSAGES_UPSERT", "MESSAGES_UPDATE", "CONNECTION_UPDATE", "QRCODE_UPDATED"];

function authorised(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const bearer = req.headers.get("authorization");
  if (bearer && bearer.toLowerCase().startsWith("bearer ") && bearer.slice(7).trim() === expected) return true;
  return req.headers.get("x-cron-secret") === expected;
}

export async function POST(req: Request) {
  if (!authorised(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const instance = url.searchParams.get("instance");
  if (!instance || !/^[\w-]{1,60}$/.test(instance)) {
    return NextResponse.json({ error: "missing_or_invalid_instance" }, { status: 400 });
  }
  const dryRun = url.searchParams.get("dry") === "1";

  const evoUrl = (process.env.EVOLUTION_API_URL ?? "").replace(/\/$/, "");
  const evoKey = process.env.EVOLUTION_API_KEY;
  if (!evoUrl || !evoKey) {
    return NextResponse.json({ error: "evolution_env_missing" }, { status: 503 });
  }

  // 1) Leer config actual
  let before: unknown = null;
  try {
    const res = await fetch(`${evoUrl}/webhook/find/${instance}`, {
      headers: { apikey: evoKey },
      signal: AbortSignal.timeout(15_000),
    });
    before = res.ok ? await res.json().catch(() => null) : { http: res.status, body: (await res.text().catch(() => "")).slice(0, 300) };
  } catch (e) {
    before = { error: e instanceof Error ? e.message : "fetch_failed" };
  }

  if (dryRun) {
    return NextResponse.json({ ok: true, instance, before, after: null, dry: true });
  }

  // 2) Aplicar la config buena
  let after: unknown = null;
  try {
    const res = await fetch(`${evoUrl}/webhook/set/${instance}`, {
      method: "POST",
      headers: { apikey: evoKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled: true,
        url: WEBHOOK_URL,
        webhookByEvents: false,
        webhookBase64: false,
        events: EVENTS,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    after = res.ok ? await res.json().catch(() => null) : { http: res.status, body: (await res.text().catch(() => "")).slice(0, 300) };
  } catch (e) {
    after = { error: e instanceof Error ? e.message : "fetch_failed" };
  }

  return NextResponse.json({ ok: true, instance, target_url: WEBHOOK_URL, before, after });
}
