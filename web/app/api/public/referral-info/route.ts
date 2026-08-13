import { NextRequest, NextResponse } from "next/server";
import { resolveReferralCode } from "@/lib/referrals";
import { checkRateLimit, ipFromHeaders } from "@/lib/rate-limit";

/**
 * GET /api/public/referral-info?code=X
 *
 * Público — lo usa la landing para renderizar el banner "🎁 {nombre}
 * te invitó...". Devuelve SOLO el nombre de pila del referidor
 * (privacidad). Código inválido → { valid: false } con 200 (la
 * landing simplemente no muestra banner, sin error).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ip = ipFromHeaders(req);
  const rl = await checkRateLimit({ scope: "referral_info", key: ip, max: 30, windowMs: 60_000 });
  if (!rl.ok) return NextResponse.json({ valid: false }, { status: 429 });

  const code = req.nextUrl.searchParams.get("code") ?? "";
  const info = await resolveReferralCode(code);
  if (!info) {
    return NextResponse.json({ valid: false });
  }
  return NextResponse.json(
    { valid: true, first_name: info.firstName },
    { headers: { "Cache-Control": "public, max-age=300" } },
  );
}
