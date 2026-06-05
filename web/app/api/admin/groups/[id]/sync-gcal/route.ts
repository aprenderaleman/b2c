import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { createClassEvent, googleCalendarConfigured } from "@/lib/google-calendar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/groups/[id]/sync-gcal
 *
 * Crea eventos en Google Calendar para todas las clases programadas
 * (status='scheduled', futuras) del grupo indicado que aún no tienen
 * `google_calendar_event_id`. Idempotente — re-ejecutar no duplica.
 *
 * Pensado para grupos recurrentes (Mon/Wed/Fri etc.) donde el admin
 * quiere ver el bloque en su calendar de un vistazo.
 *
 * Auth: admin / superadmin.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (!session?.user || (role !== "admin" && role !== "superadmin")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!googleCalendarConfigured()) {
    return NextResponse.json({ error: "gcal_not_configured" }, { status: 503 });
  }

  const { id: groupId } = await params;
  const sb = supabaseAdmin();

  const { data: group } = await sb
    .from("student_groups")
    .select(`
      id, name, level,
      teacher:teachers!inner(users!inner(full_name))
    `)
    .eq("id", groupId)
    .maybeSingle();
  if (!group) return NextResponse.json({ error: "group_not_found" }, { status: 404 });

  const teacherUser = (() => {
    const t = (group as { teacher: unknown }).teacher;
    const tFlat = Array.isArray(t) ? (t as Array<{ users: unknown }>)[0] : (t as { users: unknown });
    const uRaw = (tFlat as { users: unknown }).users;
    const u = (Array.isArray(uRaw) ? (uRaw as Array<{ full_name: string | null }>)[0] : (uRaw as { full_name: string | null }));
    return u?.full_name ?? "Profesor";
  })();

  const { data: students } = await sb
    .from("student_group_members")
    .select(`student:students!inner(user:users!inner(full_name))`)
    .eq("group_id", groupId);
  const studentNames = ((students ?? []) as Array<{ student: unknown }>).map(s => {
    const sFlat = Array.isArray(s.student) ? (s.student as Array<{ user: unknown }>)[0] : (s.student as { user: unknown });
    const uRaw = (sFlat as { user: unknown }).user;
    const u = (Array.isArray(uRaw) ? (uRaw as Array<{ full_name: string | null }>)[0] : (uRaw as { full_name: string | null }));
    return u?.full_name ?? "Alumno";
  });

  const { data: classes } = await sb
    .from("classes")
    .select("id, scheduled_at, duration_minutes, short_code, google_calendar_event_id, status")
    .eq("group_id", groupId)
    .eq("status", "scheduled")
    .gte("scheduled_at", new Date().toISOString())
    .order("scheduled_at");

  const rows = (classes ?? []) as Array<{
    id: string; scheduled_at: string; duration_minutes: number;
    short_code: string | null; google_calendar_event_id: string | null; status: string;
  }>;

  const PLATFORM_URL = process.env.PLATFORM_URL ?? "https://b2c.aprender-aleman.de";
  const groupName  = (group as { name: string }).name;
  const groupLevel = (group as { level: string | null }).level;

  let created = 0;
  let skipped = 0;
  const errors: Array<{ classId: string; error: string }> = [];

  for (const c of rows) {
    if (c.google_calendar_event_id) { skipped++; continue; }
    const joinUrl = c.short_code
      ? `${PLATFORM_URL}/c/${c.short_code}`
      : `${PLATFORM_URL}/aula/${c.id}`;
    const summary = `${groupName}${groupLevel ? ` (${groupLevel})` : ""}`;
    const desc = [
      `Profesor: ${teacherUser}`,
      `Alumno${studentNames.length === 1 ? "" : "s"}: ${studentNames.join(", ")}`,
      `Duración: ${c.duration_minutes} min`,
      "",
      `Aula: ${joinUrl}`,
    ].join("\n");

    const ev = await createClassEvent({
      summary,
      startIso:        c.scheduled_at,
      durationMinutes: c.duration_minutes,
      description:     desc,
    });
    if (!ev) {
      errors.push({ classId: c.id, error: "insert_failed" });
      continue;
    }
    const { error: upErr } = await sb
      .from("classes")
      .update({ google_calendar_event_id: ev.eventId })
      .eq("id", c.id);
    if (upErr) {
      errors.push({ classId: c.id, error: `db_update: ${upErr.message}` });
      continue;
    }
    created++;
  }

  return NextResponse.json({
    ok:      true,
    total:   rows.length,
    created,
    skipped,
    errors,
  });
}
