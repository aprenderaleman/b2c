import { supabaseAdmin } from "./supabase";

// =============================================================================
// Attendance
// =============================================================================

export type StudentAttendance = {
  student_id:    string;
  student_name:  string | null;
  student_email: string;
  level:         string;
  total:         number;
  attended:      number;
  missed:        number;
  pending:       number;       // attended=null, class is in the past ≥ 1h
  attendance_pct: number;      // attended / (attended + missed), 0-100
};

/**
 * Attendance % per student over the last N days. A class counts toward
 * the denominator only if it's in the past AND its participant row has
 * attended=true or false. We skip pending (attended=null) classes to
 * avoid penalising students for classes nobody's marked yet.
 */
export async function getStudentsAttendance(days: number): Promise<StudentAttendance[]> {
  const sb = supabaseAdmin();
  const since = new Date(Date.now() - days * 24 * 3600 * 1000);
  const cutoff = new Date(Date.now() - 60 * 60 * 1000);   // "past" = at least 1h ago

  const { data, error } = await sb
    .from("class_participants")
    .select(`
      student_id, attended,
      class:classes!inner(scheduled_at, status),
      student:students!inner(
        current_level,
        users!inner(full_name, email)
      )
    `)
    .gte("class.scheduled_at", since.toISOString())
    .lte("class.scheduled_at", cutoff.toISOString())
    .in("class.status", ["completed", "absent", "live"]);
  if (error) return [];

  type Row = {
    student_id: string;
    attended:   boolean | null;
    class:      { scheduled_at: string; status: string } | Array<{ scheduled_at: string; status: string }>;
    student: {
      current_level: string;
      users: { full_name: string | null; email: string } | Array<{ full_name: string | null; email: string }>;
    } | Array<{
      current_level: string;
      users: { full_name: string | null; email: string } | Array<{ full_name: string | null; email: string }>;
    }>;
  };

  const agg: Record<string, StudentAttendance> = {};
  for (const r of (data ?? []) as Row[]) {
    const sStu = Array.isArray(r.student) ? r.student[0] : r.student;
    if (!sStu) continue;
    const u = Array.isArray(sStu.users) ? sStu.users[0] : sStu.users;
    const entry = agg[r.student_id] ??= {
      student_id:    r.student_id,
      student_name:  u?.full_name ?? null,
      student_email: u?.email ?? "",
      level:         sStu.current_level,
      total:         0,
      attended:      0,
      missed:        0,
      pending:       0,
      attendance_pct: 0,
    };
    entry.total++;
    if (r.attended === true)       entry.attended++;
    else if (r.attended === false) entry.missed++;
    else                           entry.pending++;
  }

  for (const a of Object.values(agg)) {
    const base = a.attended + a.missed;
    a.attendance_pct = base > 0 ? Math.round((a.attended / base) * 100) : 100;
  }

  return Object.values(agg).sort((a, b) => a.attendance_pct - b.attendance_pct);
}

// =============================================================================
// Risk alerts
// =============================================================================

export type RiskAlert = {
  kind:      "two_absences" | "low_attendance" | "inactive_14d" | "no_classes";
  severity:  "warn" | "danger";
  subject:   string;    // human-readable target (student name)
  detail:    string;
  link:      string | null;
};

/**
 * Compile risk alerts for admin's "Hoy" view. Uses attendance data +
 * simple queries. Every alert has a link back to the relevant detail page.
 */
export async function computeRiskAlerts(): Promise<RiskAlert[]> {
  const alerts: RiskAlert[] = [];

  const sb = supabaseAdmin();

  // 1. Students with attendance < 70% in last 30 days.
  const attendance = await getStudentsAttendance(30);
  for (const a of attendance) {
    if (a.total < 3) continue;                   // too little data to flag
    if (a.attendance_pct < 70) {
      alerts.push({
        kind:     "low_attendance",
        severity: "warn",
        subject:  a.student_name ?? a.student_email,
        detail:   `Asistencia ${a.attendance_pct}% en 30 días (${a.attended}/${a.attended + a.missed}).`,
        link:     `/admin/estudiantes/${a.student_id}`,
      });
    }
  }

  // 2. Two consecutive absences.
  const { data: parts } = await sb
    .from("class_participants")
    .select(`
      student_id, attended,
      class:classes!inner(scheduled_at),
      student:students!inner(users!inner(full_name, email))
    `)
    .in("attended", [true, false])
    .order("scheduled_at", { ascending: false, foreignTable: "classes" })
    .limit(800);

  type PR = {
    student_id: string;
    attended:   boolean;
    class:      { scheduled_at: string } | Array<{ scheduled_at: string }>;
    student:    { users: { full_name: string | null; email: string } | Array<{ full_name: string | null; email: string }> } | Array<{ users: { full_name: string | null; email: string } | Array<{ full_name: string | null; email: string }> }>;
  };

  const bySession: Record<string, Array<{ at: string; attended: boolean }>> = {};
  for (const r of (parts ?? []) as PR[]) {
    const cc = Array.isArray(r.class) ? r.class[0] : r.class;
    (bySession[r.student_id] ??= []).push({
      at:        cc?.scheduled_at ?? "",
      attended:  r.attended,
    });
  }
  for (const [sid, list] of Object.entries(bySession)) {
    list.sort((a, b) => b.at.localeCompare(a.at));
    if (list.length >= 2 && !list[0].attended && !list[1].attended) {
      // Resolve name from the source.
      const name = (() => {
        for (const p of (parts ?? []) as PR[]) {
          if (p.student_id !== sid) continue;
          const s = Array.isArray(p.student) ? p.student[0] : p.student;
          const u = Array.isArray(s?.users) ? (s.users as Array<{ full_name: string | null; email: string }>)[0] : (s?.users as { full_name: string | null; email: string } | undefined);
          return u?.full_name ?? u?.email ?? "—";
        }
        return "—";
      })();
      alerts.push({
        kind:     "two_absences",
        severity: "danger",
        subject:  name,
        detail:   "2 ausencias consecutivas en las últimas clases.",
        link:     `/admin/estudiantes/${sid}`,
      });
    }
  }

  // 3. Students inactive 14 days (no classes attended + no login).
  const fourteenAgo = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString();
  const { data: staleStudents } = await sb
    .from("students")
    .select(`
      id, converted_at,
      users!inner(full_name, email, last_login_at)
    `)
    .eq("subscription_status", "active");
  type SS = {
    id: string;
    converted_at: string;
    users: { full_name: string | null; email: string; last_login_at: string | null } | Array<{ full_name: string | null; email: string; last_login_at: string | null }>;
  };
  for (const s of (staleStudents ?? []) as SS[]) {
    const u = Array.isArray(s.users) ? s.users[0] : s.users;
    const lastSeen = u?.last_login_at ?? s.converted_at;
    if (lastSeen && lastSeen < fourteenAgo) {
      alerts.push({
        kind:     "inactive_14d",
        severity: "warn",
        subject:  u?.full_name ?? u?.email ?? "—",
        detail:   `Sin login desde ${new Date(lastSeen).toLocaleDateString("es-ES")}.`,
        link:     `/admin/estudiantes/${s.id}`,
      });
    }
  }

  // De-dupe (same student, same kind) keeping the first.
  const seen = new Set<string>();
  return alerts.filter(a => {
    const k = `${a.kind}:${a.subject}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
