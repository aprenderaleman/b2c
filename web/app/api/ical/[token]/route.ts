import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * GET /api/ical/{token}.ics  (the ".ics" suffix is stripped server-side
 * because Next.js doesn't let us include a dot in a route segment name).
 *
 * Returns an RFC-5545 iCalendar feed of the user's upcoming classes.
 * Teachers see all classes they teach; students see all classes they
 * participate in. The token is the caller's own users.ical_token (a
 * 48-char hex secret) — a capability token, no session needed.
 *
 * Google Calendar auto-refreshes subscribed feeds roughly every 24h.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req:   Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token: rawToken } = await params;
  // Strip a trailing .ics so both /api/ical/abc123 and /api/ical/abc123.ics work.
  const token = rawToken.replace(/\.ics$/i, "");
  if (!/^[a-f0-9]{32,96}$/i.test(token)) {
    return new NextResponse("not_found", { status: 404 });
  }

  const sb = supabaseAdmin();
  const { data: user } = await sb
    .from("users")
    .select("id, role, full_name, email")
    .eq("ical_token", token)
    .maybeSingle();
  if (!user) return new NextResponse("not_found", { status: 404 });

  const role = (user as { role: string }).role;
  const userId = (user as { id: string }).id;

  // Window: 30 days back (so calendar keeps recent history) + 6 months fwd.
  const from = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const to   = new Date(Date.now() + 180 * 24 * 3600 * 1000).toISOString();

  type ClsRow = {
    id: string; title: string; scheduled_at: string; duration_minutes: number;
    status: string; livekit_room_id: string;
    topic: string | null;
    teacher_user_name: string | null;
    other_students: string[];
  };
  let classes: ClsRow[] = [];

  if (role === "teacher") {
    const { data: teacher } = await sb
      .from("teachers").select("id").eq("user_id", userId).maybeSingle();
    if (!teacher) return icsResponse(icsSkeleton(user, []), user);

    const { data, error } = await sb
      .from("classes")
      .select(`
        id, title, topic, scheduled_at, duration_minutes, status, livekit_room_id,
        class_participants(
          student:students!inner(users!inner(full_name, email))
        )
      `)
      .eq("teacher_id", (teacher as { id: string }).id)
      .gte("scheduled_at", from)
      .lte("scheduled_at", to)
      .in("status", ["scheduled", "live", "completed"])
      .order("scheduled_at", { ascending: true });
    if (error) return new NextResponse("err", { status: 500 });

    classes = (data ?? []).map(c => ({
      id: c.id as string,
      title: c.title as string,
      topic: (c.topic as string | null) ?? null,
      scheduled_at: c.scheduled_at as string,
      duration_minutes: c.duration_minutes as number,
      status: c.status as string,
      livekit_room_id: c.livekit_room_id as string,
      teacher_user_name: (user as { full_name: string | null }).full_name ?? null,
      other_students: (((c as { class_participants?: unknown[] }).class_participants ?? []) as Array<{ student: unknown }>).flatMap(p => {
        const s = p.student as Record<string, unknown> | Record<string, unknown>[];
        const sf = Array.isArray(s) ? s[0] : s;
        const u = sf?.users as Record<string, unknown> | Record<string, unknown>[];
        const uf = Array.isArray(u) ? u[0] : u;
        const name = (uf?.full_name as string | null) ?? (uf?.email as string | undefined);
        return name ? [name] : [];
      }),
    }));
  } else if (role === "student") {
    const { data: student } = await sb
      .from("students").select("id").eq("user_id", userId).maybeSingle();
    if (!student) return icsResponse(icsSkeleton(user, []), user);

    const { data, error } = await sb
      .from("class_participants")
      .select(`
        class:classes!inner(
          id, title, topic, scheduled_at, duration_minutes, status, livekit_room_id,
          teacher:teachers(users(full_name, email))
        )
      `)
      .eq("student_id", (student as { id: string }).id)
      .gte("class.scheduled_at", from)
      .lte("class.scheduled_at", to)
      .order("class(scheduled_at)", { ascending: true });
    if (error) return new NextResponse("err", { status: 500 });

    classes = ((data ?? []) as unknown[]).flatMap(raw => {
      const r = raw as { class: Record<string, unknown> | Record<string, unknown>[] };
      const c = Array.isArray(r.class) ? r.class[0] : r.class;
      if (!c) return [];
      const t = c.teacher as Record<string, unknown> | Record<string, unknown>[];
      const tf = Array.isArray(t) ? t[0] : t;
      const u = tf?.users as Record<string, unknown> | Record<string, unknown>[];
      const uf = Array.isArray(u) ? u[0] : u;
      return [{
        id:                (c.id as string),
        title:             (c.title as string),
        topic:             ((c.topic as string | null) ?? null),
        scheduled_at:      (c.scheduled_at as string),
        duration_minutes:  (c.duration_minutes as number),
        status:            (c.status as string),
        livekit_room_id:   (c.livekit_room_id as string),
        teacher_user_name: ((uf?.full_name as string | null) ?? (uf?.email as string | undefined) ?? null),
        other_students:    [],
      }];
    });
  } else {
    return new NextResponse("no_calendar_for_role", { status: 403 });
  }

  const body = icsSkeleton(user, classes);
  return icsResponse(body, user);
}

type UserLite = { id: string; role: string; full_name: string | null; email: string };

function icsSkeleton(user: UserLite, classes: Array<{
  id: string; title: string; topic: string | null; scheduled_at: string; duration_minutes: number;
  status: string; livekit_room_id: string; teacher_user_name: string | null; other_students: string[];
}>): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Aprender-Aleman.de//LMS//ES",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `NAME:Aprender-Aleman.de · ${icsEscape(user.full_name ?? user.email)}`,
    `X-WR-CALNAME:Aprender-Aleman.de · ${icsEscape(user.full_name ?? user.email)}`,
    "X-WR-TIMEZONE:Europe/Berlin",
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "https://b2c.aprender-aleman.de";
  for (const c of classes) {
    const start   = new Date(c.scheduled_at);
    const end     = new Date(start.getTime() + c.duration_minutes * 60_000);
    const roleUrl = user.role === "teacher" ? "/profesor/clases" : "/estudiante/clases";
    const descrLines = [
      user.role === "teacher" ? "Clase que das tú como profesor." : `Profesor: ${c.teacher_user_name ?? "—"}`,
      c.other_students.length > 0 ? `Alumnos: ${c.other_students.join(", ")}` : "",
      c.topic ? `Tema: ${c.topic}` : "",
      `Detalles: ${base}${roleUrl}/${c.id}`,
      `Aula virtual: ${base}/aula/${c.id}`,
    ].filter(Boolean);
    lines.push(
      "BEGIN:VEVENT",
      `UID:${c.id}@aprender-aleman.de`,
      `DTSTAMP:${toIcsDate(new Date())}`,
      `DTSTART:${toIcsDate(start)}`,
      `DTEND:${toIcsDate(end)}`,
      `SUMMARY:${icsEscape(c.title)}`,
      `DESCRIPTION:${icsEscape(descrLines.join("\\n"))}`,
      `LOCATION:${base}/aula/${c.id}`,
      `URL:${base}/aula/${c.id}`,
      `STATUS:${c.status === "cancelled" ? "CANCELLED" : "CONFIRMED"}`,
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

function icsResponse(body: string, user: UserLite): NextResponse {
  const filename = `aprender-aleman-${(user.full_name ?? user.email).toLowerCase().replace(/[^a-z0-9]+/g, "-")}.ics`;
  return new NextResponse(body, {
    headers: {
      "Content-Type":        "text/calendar; charset=utf-8",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control":       "public, max-age=900",   // 15 min — matches Google's minimum effective poll
    },
  });
}

function toIcsDate(d: Date): string {
  // YYYYMMDDTHHMMSSZ  (UTC)
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth()+1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

function icsEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}
