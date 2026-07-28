import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { sendCloserDailyDigestEmail } from "@/lib/email/send";

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? "https://b2c.aprender-aleman.de";

function authorised(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const bearer = req.headers.get("authorization");
  if (bearer && bearer.toLowerCase().startsWith("bearer ")) {
    if (bearer.slice(7).trim() === expected) return true;
  }
  const xh = req.headers.get("x-cron-secret");
  if (xh && xh === expected) return true;
  return false;
}

export async function GET(req: Request) {
  if (!authorised(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const sb = supabaseAdmin();

  const { data: closers } = await sb
    .from("users")
    .select("id, full_name, email")
    .eq("role", "closer")
    .eq("is_active", true);

  if (!closers || closers.length === 0) {
    return NextResponse.json({ ok: true, sent: 0 });
  }

  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);

  let sent = 0;

  for (const closer of closers) {
    const [tareasHoy, tareasAtrasadas, leadsActivos, leadsConvertidos, ventasPendientes] =
      await Promise.all([
        sb
          .from("tareas_closer")
          .select("id", { count: "exact", head: true })
          .eq("closer_id", closer.id)
          .gte("fecha_programada", todayStart.toISOString())
          .lte("fecha_programada", todayEnd.toISOString())
          .is("fecha_completada", null),
        sb
          .from("tareas_closer")
          .select("id", { count: "exact", head: true })
          .eq("closer_id", closer.id)
          .lt("fecha_programada", todayStart.toISOString())
          .is("fecha_completada", null),
        sb
          .from("leads")
          .select("id", { count: "exact", head: true })
          .eq("closer_id", closer.id)
          .in("estado_cierre", ["en_seguimiento", "venta_pendiente"]),
        sb
          .from("leads")
          .select("id", { count: "exact", head: true })
          .eq("closer_id", closer.id)
          .eq("estado_cierre", "convertido"),
        sb
          .from("ventas")
          .select("id", { count: "exact", head: true })
          .eq("solicitado_por", closer.id)
          .eq("estado", "pendiente"),
      ]);

    const totalAssigned = (leadsActivos.count ?? 0) + (leadsConvertidos.count ?? 0);
    const converted = leadsConvertidos.count ?? 0;
    const closeRate = totalAssigned > 0 ? (converted / totalAssigned) * 100 : 0;

    await sendCloserDailyDigestEmail(closer.email, {
      closerName: closer.full_name ?? "Closer",
      tareasHoy: tareasHoy.count ?? 0,
      tareasAtrasadas: tareasAtrasadas.count ?? 0,
      leadsActivos: leadsActivos.count ?? 0,
      closeRate,
      ventasPendientes: ventasPendientes.count ?? 0,
      dashboardUrl: `${BASE_URL}/closer`,
    });
    sent++;
  }

  return NextResponse.json({ ok: true, sent });
}
