import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolveCloserActor } from "@/lib/closer-auth";
import { isCatalogActive, getActiveCatalog, getBonusMultiplier } from "@/lib/catalog";

/**
 * GET /api/closer/bonus-ladder — Current month's sales count and
 * bonus multiplier. Only returns data when catalog v2+ is active.
 */
export async function GET() {
  const actor = await resolveCloserActor();
  if (!actor) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  if (!(await isCatalogActive())) {
    return NextResponse.json({ active: false });
  }

  const cat = await getActiveCatalog();
  const sb = supabaseAdmin();

  const mes = new Date().toISOString().slice(0, 7) + "-01";

  const { count } = await sb
    .from("comisiones")
    .select("id", { count: "exact", head: true })
    .eq("usuario_id", actor.id)
    .eq("tipo", "bono_cierre")
    .eq("mes", mes);

  const salesCount = count ?? 0;
  const multiplier = getBonusMultiplier(cat, salesCount);
  const threshold = cat.ladder?.threshold ?? 4;

  return NextResponse.json({
    active: true,
    salesCount,
    threshold,
    multiplier,
    ladderActive: salesCount >= threshold,
    nextSaleMultiplied: salesCount + 1 >= threshold,
  });
}
