import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { assignCloser } from "@/lib/closer-actions";

/**
 * GET /api/cron/closer-drip-assign
 *
 * Goteo de backlog (Gelfis 2026-08-05): los leads que ASISTIERON al
 * trial en los últimos 7 días y siguen sin closer se reparten poco a
 * poco — 1 lead por closer activo en cada pasada del cron — en vez de
 * inundar la cola de golpe.
 *
 * - Solo leads con trial_attended_at en la ventana de 7 días.
 *   (Los "no asistió" del backlog NO entran: decisión Gelfis.)
 * - Solo closers con active=true y flujo_activo=true.
 * - Se asigna el más antiguo primero (para que no caduque de la ventana).
 * - Reparto al closer con menos carga viva (activo + seguimiento_pactado).
 * - Usa assignCloser(): estado activo + cadencia tipo A + timeline.
 *
 * Los leads nuevos (marcados después del go-live) siguen entrando por
 * autoAssignToActiveCloser al momento — este cron solo drena backlog.
 *
 * Auth: Bearer CRON_SECRET.
 */

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
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();

  // Closers en rotación
  const { data: closers } = await sb
    .from("users")
    .select("id, full_name, email")
    .eq("role", "closer")
    .eq("active", true)
    .eq("flujo_activo", true);

  const activeClosers = (closers ?? []) as Array<{ id: string; full_name: string | null; email: string }>;
  if (activeClosers.length === 0) {
    return NextResponse.json({ ok: true, assigned: 0, reason: "no_active_closers" });
  }

  // Backlog elegible: asistieron en los últimos 7 días, sin closer
  const { data: pending } = await sb
    .from("leads")
    .select("id, name, trial_attended_at")
    .is("closer_id", null)
    .gte("trial_attended_at", sevenDaysAgo)
    .not("status", "in", "(converted,lost)")
    .not("estado_cierre", "in", "(convertido,perdido)")
    .order("trial_attended_at", { ascending: true })
    .limit(activeClosers.length);

  const leads = (pending ?? []) as Array<{ id: string; name: string | null; trial_attended_at: string }>;
  if (leads.length === 0) {
    return NextResponse.json({ ok: true, assigned: 0, reason: "backlog_empty" });
  }

  // Carga viva por closer → el que menos tiene recibe primero
  const ids = activeClosers.map((c) => c.id);
  const { data: loads } = await sb
    .from("leads")
    .select("closer_id")
    .in("closer_id", ids)
    .in("estado_cierre", ["activo", "seguimiento_pactado"]);

  const loadMap: Record<string, number> = {};
  for (const id of ids) loadMap[id] = 0;
  for (const row of (loads ?? []) as Array<{ closer_id: string }>) {
    loadMap[row.closer_id] = (loadMap[row.closer_id] ?? 0) + 1;
  }
  const sorted = [...activeClosers].sort((a, b) => (loadMap[a.id] ?? 0) - (loadMap[b.id] ?? 0));

  // 1 lead por closer por pasada
  const results: Array<{ lead: string; closer: string; tasks: number }> = [];
  for (let i = 0; i < leads.length && i < sorted.length; i++) {
    const lead = leads[i];
    const closer = sorted[i];
    try {
      const tasks = await assignCloser(lead.id, closer.id, "tipo_a");
      results.push({ lead: lead.name ?? lead.id, closer: closer.full_name ?? closer.email, tasks });
    } catch (err) {
      console.error(`[closer-drip-assign] failed for lead ${lead.id}:`, err);
    }
  }

  return NextResponse.json({ ok: true, assigned: results.length, results });
}
