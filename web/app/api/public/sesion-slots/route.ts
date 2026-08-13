import { NextResponse } from "next/server";
import { listSesionSlots } from "@/lib/sesion-slots";

/**
 * GET /api/public/sesion-slots — slots de Sesión de Plan (20 min con un
 * closer) según closer_availability. Público, sin auth. Gemelo de
 * /api/public/trial-slots.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const slots = await listSesionSlots();
    return NextResponse.json(
      { ok: true, slots },
      { headers: { "Cache-Control": "private, no-cache, no-store, must-revalidate" } },
    );
  } catch (err) {
    console.error("[sesion-slots] error:", err);
    return NextResponse.json({ ok: false, slots: [] }, { status: 500 });
  }
}
