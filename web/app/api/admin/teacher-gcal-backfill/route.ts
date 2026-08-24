import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { getConnectedTeacherIds } from "@/lib/google-calendar-oauth";
import { mirrorClassesToTeacherCalendar } from "@/lib/teacher-calendar-sync";

/**
 * POST /api/admin/teacher-gcal-backfill
 *
 * One-shot admin: espeja en el Google Calendar personal de cada profe
 * CONECTADO todas sus clases futuras (status=scheduled) que aún no
 * tienen teacher_gcal_event_id (migración 120). Idempotente — correr
 * varias veces no duplica eventos.
 *
 * Auth: sesión admin o Bearer CRON_SECRET (mismo patrón que
 * sesiones-gcal-backfill).
 */

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  const cronOk = Boolean(process.env.CRON_SECRET) && bearer === process.env.CRON_SECRET;
  if (!cronOk) {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const user = session.user as { role?: string };
    if (!user.role || !["admin", "superadmin"].includes(user.role)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  }

  const sb = supabaseAdmin();
  const nowIso = new Date().toISOString();

  const { data: rows, error } = await sb
    .from("classes")
    .select("id, teacher_id")
    .eq("status", "scheduled")
    .gte("scheduled_at", nowIso)
    .is("teacher_gcal_event_id", null)
    .not("teacher_id", "is", null)
    .is("deleted_at", null)
    .limit(500);
  if (error) return NextResponse.json({ error: "query_failed", message: error.message }, { status: 500 });

  const all = (rows ?? []) as Array<{ id: string; teacher_id: string }>;
  const teacherIds = [...new Set(all.map(r => r.teacher_id))];
  const connected = new Set(await getConnectedTeacherIds(teacherIds));
  const candidates = all.filter(r => connected.has(r.teacher_id)).map(r => r.id);

  const created = await mirrorClassesToTeacherCalendar(candidates);

  return NextResponse.json({
    ok: true,
    future_scheduled_without_event: all.length,
    teachers_connected: connected.size,
    candidates: candidates.length,
    events_created: created,
  });
}
