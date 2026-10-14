import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { createAdminNotification } from "@/lib/admin-notifications";

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
  const now = new Date();
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const { data: overdueTasks } = await sb
    .from("tareas_closer")
    .select(`
      id,
      closer_id,
      lead_id,
      paso,
      canal,
      fecha_programada,
      leads!inner(full_name)
    `)
    .lt("fecha_programada", twentyFourHoursAgo.toISOString())
    .is("fecha_completada", null)
    .limit(50);

  let alertCount = 0;

  if (overdueTasks && overdueTasks.length > 0) {
    const byCloser = new Map<string, typeof overdueTasks>();
    for (const t of overdueTasks) {
      const arr = byCloser.get(t.closer_id) ?? [];
      arr.push(t);
      byCloser.set(t.closer_id, arr);
    }

    for (const [closerId, tasks] of byCloser) {
      await createAdminNotification({
        type: "closer_tareas_atrasadas",
        severity: "warning",
        title: "Closer con tareas atrasadas",
        body: `Closer tiene ${tasks.length} tarea(s) atrasada(s) > 24h sin completar.`,
        action_url: "/admin/closers",
      });
      alertCount++;
    }
  }

  const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
  const { data: staleLeads } = await sb
    .from("leads")
    .select("id, full_name, closer_id")
    .in("estado_cierre", ["activo", "seguimiento_pactado"])
    .not("closer_id", "is", null)
    .lt("updated_at", threeDaysAgo.toISOString())
    .limit(50);

  if (staleLeads && staleLeads.length > 0) {
    // Notif "lead sin actividad" desactivada (Gelfis 2026-10-14, ruido).
    // El panel de closer ya muestra leads inactivos ordenados por última
    // actividad — notificar en el bell es redundante y spamea.
    void staleLeads;   // silence lint
  }

  return NextResponse.json({ ok: true, overdue: overdueTasks?.length ?? 0, stale: staleLeads?.length ?? 0, alertCount });
}
