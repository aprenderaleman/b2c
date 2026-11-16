import { NextResponse } from "next/server";
import { sendWhatsappText } from "@/lib/whatsapp";

/**
 * GET /api/admin/wa/test-send?secret=...&to=49...&text=...&kind=trial_confirmation
 *
 * Envía un WhatsApp de prueba usando TODOS los guardrails normales
 * (night gate, caps, blocklist, dedup, canal setter). Devuelve el
 * resultado exacto de sendWhatsappText.
 *
 * Auth: query ?secret o header X-Cron-Secret = CRON_SECRET.
 * Gelfis 2026-11-16: verificación post-reconexión V6.
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

  const to = url.searchParams.get("to") ?? "";
  const text = url.searchParams.get("text") ?? "🧪 Test de reconexión V6 — Aprender-Aleman.de · 2026-11-16";
  const kind = url.searchParams.get("kind") ?? "trial_confirmation";
  const channel = url.searchParams.get("channel") ?? "setter";

  if (!/^\+?\d{8,15}$/.test(to)) {
    return NextResponse.json({ error: "invalid_to", expected: "+49..." }, { status: 400 });
  }
  const phoneE164 = to.startsWith("+") ? to : `+${to}`;

  const res = await sendWhatsappText(phoneE164, text, {
    kind,
    channel: channel === "setter" ? "setter" : undefined,
  });

  return NextResponse.json({
    to: phoneE164,
    kind,
    channel,
    text_preview: text.slice(0, 80),
    result: res,
  });
}
