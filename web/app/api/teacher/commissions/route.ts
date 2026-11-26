import { getTeacherCommission } from "@/lib/teacher-commission";
import { NextResponse } from "next/server";
import { requireTeacherSession } from "@/lib/teacher-trial-auth";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  let user;
  try { user = await requireTeacherSession(); }
  catch { return NextResponse.json({ error: "unauthorized" }, { status: 401 }); }

  const url = new URL(req.url);
  const mesParam = url.searchParams.get("mes");
  const mes = mesParam ?? new Date().toISOString().slice(0, 7) + "-01";

  const sb = supabaseAdmin();

  // Comisión acordada (si la hay) o la del rango.
  const commission = await getTeacherCommission(user.id);

  const { data: comisiones } = await sb
    .from("comisiones")
    .select("id, monto_cents, base_amount_cents, comision_pct, escenario, mes, pagado, created_at")
    .eq("usuario_id", user.id)
    .eq("mes", mes)
    .order("created_at", { ascending: false });

  const totalCents = (comisiones ?? []).reduce(
    (sum: number, c: { monto_cents: number }) => sum + c.monto_cents, 0
  );

  return NextResponse.json({
    rango: commission.rango,
    comision_pct: commission.pct,
    comision_acordada: commission.custom,
    mes,
    comisiones: comisiones ?? [],
    total_cents: totalCents,
  });
}
