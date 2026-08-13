import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { applyReferralReward } from "@/lib/referrals";

/**
 * POST /api/internal/referral-reward  { lead_id }
 *
 * Aplica manualmente la recompensa de referido de un lead YA
 * convertido. Uso operativo: conversiones que ocurrieron antes de que
 * la atribución existiera, o backfills. Es idempotente (lib/referrals)
 * — repetirlo nunca duplica.
 *
 * Auth: admin/superadmin o Bearer CRON_SECRET.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const bearer = req.headers.get("authorization");
  let authorised = !!secret && bearer === `Bearer ${secret}`;
  if (!authorised) {
    const session = await auth();
    const role = (session?.user as { role?: string } | undefined)?.role;
    authorised = role === "admin" || role === "superadmin";
  }
  if (!authorised) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { lead_id?: string } = {};
  try { body = await req.json(); } catch { /* below */ }
  if (!body.lead_id || !/^[0-9a-f-]{36}$/i.test(body.lead_id)) {
    return NextResponse.json({ error: "lead_id_required" }, { status: 400 });
  }

  const result = await applyReferralReward(body.lead_id);
  return NextResponse.json({ ok: true, ...result });
}
