import { NextResponse } from "next/server";
import { listTrialSlots } from "@/lib/trial-slots";

/**
 * GET /api/public/trial-slots
 *
 * Public — no auth. Returns up to 60 upcoming free trial-class slots,
 * each annotated with the teacher who'd take that slot per the
 * rotation algorithm.
 *
 * Cache-Control: private no-cache so the funnel always shows fresh
 * availability after another lead just booked the same time.
 */
export const runtime  = "nodejs";
export const dynamic  = "force-dynamic";

export async function GET() {
  try {
    const slots = await listTrialSlots();
    return NextResponse.json({ ok: true, slots }, {
      headers: { "Cache-Control": "private, no-cache, no-store, must-revalidate" },
    });
  } catch (e) {
    console.error("[trial-slots] fail:", e);
    return NextResponse.json({ ok: false, slots: [] }, { status: 500 });
  }
}
