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

  const { data: rango } = await sb
    .from("users")
    .select("rango")
    .eq("id", user.id)
    .maybeSingle();

  const { data: rangoConfig } = await sb
    .from("config_rangos")
    .select("comision_pct")
    .eq("rol", "teacher")
    .eq("rango", (rango as { rango: string } | null)?.rango ?? "starter")
    .maybeSingle();

  const { data: comisiones } = await sb
    .from("comisiones")
    .select("id, monto_cents, moneda, base_amount_cents, comision_pct, escenario, mes, pagado, created_at")
    .eq("usuario_id", user.id)
    .eq("mes", mes)
    .order("created_at", { ascending: false });

  const totalCents = (comisiones ?? []).reduce(
    (sum: number, c: { monto_cents: number }) => sum + c.monto_cents, 0
  );

  return NextResponse.json({
    rango: (rango as { rango: string } | null)?.rango ?? "starter",
    comision_pct: (rangoConfig as { comision_pct: number } | null)?.comision_pct ?? 5,
    mes,
    comisiones: comisiones ?? [],
    total_cents: totalCents,
  });
}
