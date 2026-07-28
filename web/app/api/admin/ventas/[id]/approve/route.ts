import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { ConvertBody, convertLeadToStudent } from "@/lib/lead-conversion";
import { calculateCommissions } from "@/lib/closer-commissions";
import { recalculateRank } from "@/lib/ranking";

const Body = ConvertBody;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const role = (session.user as { role?: string }).role;
  if (role !== "superadmin" && role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id: ventaId } = await params;
  const adminId = (session.user as { id: string }).id;
  const sb = supabaseAdmin();

  const { data: venta } = await sb
    .from("ventas")
    .select("*, leads!inner(id, closer_id)")
    .eq("id", ventaId)
    .eq("estado", "pendiente")
    .single();

  if (!venta) {
    return NextResponse.json({ error: "venta_not_found_or_not_pending" }, { status: 404 });
  }

  let rawBody: unknown;
  try { rawBody = await req.json(); }
  catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }

  const parsed = Body.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed", details: parsed.error.flatten() }, { status: 400 });
  }

  // 1. Approve the sale
  await sb
    .from("ventas")
    .update({
      estado: "aprobada",
      aprobado_por: adminId,
      aprobado_at: new Date().toISOString(),
    })
    .eq("id", ventaId);

  // 2. Convert lead to student
  const leadId = venta.lead_id as string;
  let convertResult;
  try {
    convertResult = await convertLeadToStudent(leadId, parsed.data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return NextResponse.json({ error: "conversion_failed", message: msg }, { status: 500 });
  }

  // 3. Update lead estado_cierre
  await sb
    .from("leads")
    .update({ estado_cierre: "convertido" })
    .eq("id", leadId);

  // 4. Calculate and save commissions
  let comisiones;
  try {
    comisiones = await calculateCommissions(ventaId);
  } catch (e) {
    console.error("[approve] calculateCommissions failed:", e instanceof Error ? e.message : e);
    comisiones = [];
  }

  // 5. Recalculate ranks
  const closerId = (venta.leads as { closer_id: string | null }).closer_id;
  if (closerId) {
    try { await recalculateRank(closerId, "closer"); } catch { /* non-fatal */ }
  }

  const { data: trialClass } = await sb
    .from("classes")
    .select("teacher_id")
    .eq("lead_id", leadId)
    .eq("is_trial", true)
    .in("status", ["completed", "scheduled", "live"])
    .order("scheduled_at", { ascending: false })
    .limit(1);

  const teacherId = (trialClass?.[0] as { teacher_id?: string } | undefined)?.teacher_id;
  if (teacherId) {
    try { await recalculateRank(teacherId, "teacher"); } catch { /* non-fatal */ }
  }

  return NextResponse.json({
    ok: true,
    convertResult,
    comisiones: comisiones.length,
  });
}
