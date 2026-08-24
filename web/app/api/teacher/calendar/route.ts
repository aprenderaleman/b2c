import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getTeacherByUserId } from "@/lib/academy";
import { supabaseAdmin } from "@/lib/supabase";
import { getTeacherAvailability } from "@/lib/availability";

/**
 * GET /api/teacher/calendar?start=ISO&end=ISO
 *
 * Datos para el calendario semanal del profesor: sus clases dentro de
 * la ventana [start, end) con nombres de estudiantes (o lead si es
 * trial) + su disponibilidad semanal para pintar las bandas en el grid.
 * Admin puede consultar con ?teacherId=.
 */

export const runtime = "nodejs";

export type CalendarEvent = {
  id:               string;
  title:            string;
  type:             string;             // individual | group | trial
  status:           string;             // scheduled | live | completed | cancelled
  scheduled_at:     string;
  duration_minutes: number;
  is_trial:         boolean;
  is_recurring:     boolean;            // pertenece a una serie
  parent_class_id:  string | null;
  recurrence_pattern: string | null;
  participants:     Array<{ studentId: string; name: string; whatsapp: string | null }>;
  lead:             { id: string; name: string | null; whatsapp: string | null } | null;
};

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const role = (session.user as { role?: string }).role;

  const url = new URL(req.url);
  let teacherId: string | null = null;
  if (role === "teacher") {
    const me = await getTeacherByUserId((session.user as { id: string }).id);
    if (!me) return NextResponse.json({ error: "no_teacher_profile" }, { status: 403 });
    teacherId = me.id;
  } else if (role === "admin" || role === "superadmin") {
    teacherId = url.searchParams.get("teacherId");
    if (!teacherId) return NextResponse.json({ error: "teacherId_required" }, { status: 400 });
  } else {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const start = url.searchParams.get("start");
  const end   = url.searchParams.get("end");
  if (!start || !end || isNaN(Date.parse(start)) || isNaN(Date.parse(end))) {
    return NextResponse.json({ error: "start_end_required" }, { status: 400 });
  }

  const sb = supabaseAdmin();
  const { data: rows, error } = await sb
    .from("classes")
    .select(`
      id, title, type, status, scheduled_at, duration_minutes, is_trial,
      parent_class_id, recurrence_pattern, lead_id,
      class_participants(
        student_id,
        students!inner(id, user_id, users!inner(full_name, email), leads!students_lead_id_fkey(whatsapp_normalized))
      )
    `)
    .eq("teacher_id", teacherId)
    .gte("scheduled_at", start)
    .lt("scheduled_at", end)
    .neq("status", "cancelled")
    .is("deleted_at", null)
    .order("scheduled_at", { ascending: true });
  if (error) {
    return NextResponse.json({ error: "query_failed", message: error.message }, { status: 500 });
  }

  type UserJoin = { full_name: string | null; email: string };
  type LeadJoin = { whatsapp_normalized: string | null };
  type StudentJoin = {
    id: string; user_id: string;
    users: UserJoin | UserJoin[];
    leads: LeadJoin | LeadJoin[] | null;
  };
  type Row = {
    id: string; title: string; type: string; status: string;
    scheduled_at: string; duration_minutes: number; is_trial: boolean;
    parent_class_id: string | null; recurrence_pattern: string | null;
    lead_id: string | null;
    class_participants: Array<{
      student_id: string;
      students: StudentJoin | StudentJoin[];
    }>;
  };

  const classRows = (rows ?? []) as Row[];

  // Leads de los trials en un solo query
  const leadIds = [...new Set(classRows.map(r => r.lead_id).filter(Boolean))] as string[];
  const leadsById = new Map<string, { id: string; name: string | null; whatsapp: string | null }>();
  if (leadIds.length > 0) {
    const { data: leads } = await sb
      .from("leads")
      .select("id, name, whatsapp_normalized")
      .in("id", leadIds);
    for (const l of (leads ?? []) as Array<{ id: string; name: string | null; whatsapp_normalized: string | null }>) {
      leadsById.set(l.id, { id: l.id, name: l.name, whatsapp: l.whatsapp_normalized });
    }
  }

  const events: CalendarEvent[] = classRows.map(r => {
    const participants = (r.class_participants ?? []).map(p => {
      const s = Array.isArray(p.students) ? p.students[0] : p.students;
      if (!s) return null;
      const u = Array.isArray(s.users) ? s.users[0] : s.users;
      const l = Array.isArray(s.leads) ? s.leads[0] : s.leads;
      return {
        studentId: s.id,
        name:      (u?.full_name ?? u?.email ?? "Estudiante").trim(),
        whatsapp:  l?.whatsapp_normalized ?? null,
      };
    }).filter(Boolean) as CalendarEvent["participants"];

    return {
      id:               r.id,
      title:            r.title,
      type:             r.type,
      status:           r.status,
      scheduled_at:     r.scheduled_at,
      duration_minutes: r.duration_minutes,
      is_trial:         r.is_trial,
      is_recurring:     r.parent_class_id !== null || r.recurrence_pattern !== null,
      parent_class_id:  r.parent_class_id,
      recurrence_pattern: r.recurrence_pattern,
      participants,
      lead: r.lead_id ? (leadsById.get(r.lead_id) ?? { id: r.lead_id, name: null, whatsapp: null }) : null,
    };
  });

  const availability = await getTeacherAvailability(teacherId).catch(() => []);

  return NextResponse.json({
    events,
    availability: availability
      .filter(b => b.available)
      .map(b => ({ day_of_week: b.day_of_week, start_time: b.start_time, end_time: b.end_time })),
  });
}
