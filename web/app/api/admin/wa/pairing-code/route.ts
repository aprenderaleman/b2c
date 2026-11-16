import { NextResponse } from "next/server";

/**
 * GET /api/admin/wa/pairing-code?number=491234567890&instance=Aprender-Aleman-v5&secret=<CRON_SECRET>
 *
 * Genera el pairing code de 8 caracteres para vincular un número a una
 * instancia Evolution SIN QR. Útil cuando el UI de Evolution no expone
 * la opción "Conectar con teléfono" (Gelfis 2026-11-16).
 *
 * Auth: query ?secret o header X-Cron-Secret = CRON_SECRET.
 *
 * Respuesta:
 *   { ok, status, pairingCode: "ABCD-EFGH", code: "...qr base64...", raw: {...} }
 *
 * Luego en el móvil: WhatsApp → Ajustes → Dispositivos vinculados →
 * Vincular un dispositivo → "Vincular con número de teléfono" → pega el pairingCode.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);

  const expected = process.env.CRON_SECRET;
  const provided =
    url.searchParams.get("secret") ??
    req.headers.get("x-cron-secret") ??
    (req.headers.get("authorization")?.toLowerCase().startsWith("bearer ")
      ? req.headers.get("authorization")!.slice(7).trim()
      : null);
  if (!expected || provided !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const rawNumber = url.searchParams.get("number") ?? "";
  const instance = url.searchParams.get("instance") ?? "Aprender-Aleman-v5";
  if (!/^\+?\d{8,15}$/.test(rawNumber)) {
    return NextResponse.json(
      { error: "invalid_number", expected: "+XX... (8-15 digits), optional leading +" },
      { status: 400 },
    );
  }
  const number = rawNumber.replace(/^\+/, "");

  const evoUrl = (process.env.EVOLUTION_API_URL ?? "").replace(/\/$/, "");
  const evoKey = process.env.EVOLUTION_API_KEY;
  if (!evoUrl || !evoKey) {
    return NextResponse.json({ error: "evolution_env_missing" }, { status: 503 });
  }

  try {
    const res = await fetch(
      `${evoUrl}/instance/connect/${encodeURIComponent(instance)}?number=${number}`,
      {
        method: "GET",
        headers: { apikey: evoKey },
        signal: AbortSignal.timeout(20_000),
      },
    );
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return NextResponse.json({
      ok: res.ok,
      status: res.status,
      instance,
      number,
      pairingCode: (data as { pairingCode?: string }).pairingCode ?? null,
      code: (data as { code?: string }).code ? "<qr-base64-oculto-brevedad>" : null,
      raw: data,
    });
  } catch (e) {
    return NextResponse.json(
      { error: "fetch_failed", detail: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
