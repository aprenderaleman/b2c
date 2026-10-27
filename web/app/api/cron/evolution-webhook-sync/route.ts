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
  // restart=1 → POST /instance/restart/{instance}: reconexión limpia de
  // la sesión Baileys que además recarga la config de webhook (algunas
  // builds de Evolution cachean la config vieja en runtime). No requiere
  // re-escanear el QR. Un único restart puntual — no loops (anti-ban).
  const restart = url.searchParams.get("restart") === "1";

  const evoUrl = (process.env.EVOLUTION_API_URL ?? "").replace(/\/$/, "");
  const evoKey = process.env.EVOLUTION_API_KEY;
  if (!evoUrl || !evoKey) {
    return NextResponse.json({ error: "evolution_env_missing" }, { status: 503 });
  }

  // 0) Estado de conexión de la instancia (¿sesión Baileys viva?)
  let connection: unknown = null;
  try {
    const res = await fetch(`${evoUrl}/instance/connectionState/${instance}`, {
      headers: { apikey: evoKey },
      signal: AbortSignal.timeout(15_000),
    });
    connection = res.ok ? await res.json().catch(() => null) : { http: res.status };
  } catch (e) {
    connection = { error: e instanceof Error ? e.message : "fetch_failed" };
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
    return NextResponse.json({ ok: true, instance, connection, before, after: null, dry: true });
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

  // 3) Restart opcional de la instancia (recarga config + sesión)
  let restarted: unknown = null;
  if (restart) {
    try {
      const res = await fetch(`${evoUrl}/instance/restart/${instance}`, {
        method: "PUT",
        headers: { apikey: evoKey },
        signal: AbortSignal.timeout(20_000),
      });
      // Evolution v1.8 usa PUT; algunas builds aceptan POST.
      if (res.status === 404 || res.status === 405) {
        const alt = await fetch(`${evoUrl}/instance/restart/${instance}`, {
          method: "POST",
          headers: { apikey: evoKey },
          signal: AbortSignal.timeout(20_000),
        });
        restarted = { http: alt.status, via: "POST" };
      } else {
        restarted = { http: res.status, via: "PUT" };
      }
    } catch (e) {
      restarted = { error: e instanceof Error ? e.message : "fetch_failed" };
    }
  }

  return NextResponse.json({ ok: true, instance, connection, target_url: WEBHOOK_URL, before, after, restarted });
}
