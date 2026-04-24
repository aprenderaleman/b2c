import { supabaseAdmin } from "./supabase";

export type CefrLevel = "A0" | "A1" | "A2" | "B1" | "B2" | "C1" | "C2";
export const ALL_CEFR_LEVELS: CefrLevel[] = ["A0", "A1", "A2", "B1", "B2", "C1", "C2"];

export type StudentGroupRow = {
  id:            string;
  name:          string;
  class_type:    "group" | "individual";
  /** Legacy single-level field. Kept for back-compat; source of truth is `levels`. */
  level:         string | null;
  /** CEFR levels this group spans. Groups can straddle multiple levels. */
  levels:        CefrLevel[];
  teacher_id:    string | null;
  start_date:    string | null;
  end_date:      string | null;
  capacity:      number | null;
  meet_link:     string | null;
  document_url:  string | null;
  active:        boolean;
  notes:         string | null;
  created_at:    string;
};

/**
 * Returns the student_group a given class belongs to (if any — historical
 * classes and Maria Eugenia-style ad-hoc classes can have group_id null).
 */
export async function getGroupForClass(classId: string): Promise<StudentGroupRow | null> {
  const sb = supabaseAdmin();
  const { data } = await sb
    .from("classes")
    .select(`
      group_id,
      group:student_groups(
        id, name, class_type, level, levels, teacher_id, start_date, end_date,
        capacity, meet_link, document_url, active, notes, created_at
      )
    `)
    .eq("id", classId)
    .maybeSingle();
  if (!data?.group_id) return null;
  const g = (data as { group: unknown }).group;
  return (Array.isArray(g) ? g[0] : g) as StudentGroupRow | null;
}

export type GroupMemberLite = {
  student_id: string;
  full_name:  string | null;
  email:      string;
  level:      string | null;
};

export type UpcomingClassLite = {
  id:               string;
  scheduled_at:     string;
  duration_minutes: number;
  title:            string;
  status:           string;
};

export type RecordingLite = {
  id:           string;
  class_id:     string;
  class_title:  string;
  class_date:   string;
  file_url:     string | null;
  duration_sec: number | null;
  status:       string;
};

export type GroupListRow = StudentGroupRow & {
  teacher_name:      string | null;
  members:           GroupMemberLite[];
  upcoming_classes:  UpcomingClassLite[];   // next 3
  latest_recording:  RecordingLite | null;
};

/**
 * All student_groups with everything the admin /grupos page needs:
 * teacher name, full members list, next 3 scheduled classes, and the
 * most recent ready recording across all the group's classes.
 */
export async function listAllStudentGroups(): Promise<GroupListRow[]> {
  const sb = supabaseAdmin();

  // Base: groups + teacher + member student ids / names / level
  const { data: groups } = await sb
    .from("student_groups")
    .select(`
      id, name, class_type, level, levels, teacher_id, start_date, end_date,
      capacity, meet_link, document_url, active, notes, created_at,
      teacher:teachers(users(full_name)),
      student_group_members(
        student:students(
          id, current_level,
          users(full_name, email)
        )
      )
    `)
    .order("active", { ascending: false })
    .order("name", { ascending: true });

  const groupRows = (groups ?? []) as unknown[];
  if (groupRows.length === 0) return [];

  const groupIds = groupRows.map(g => (g as { id: string }).id);

  // Upcoming: next 50 scheduled classes across ALL these groups, then
  // we bucket client-side by group and keep the first 3 per group.
  const nowIso = new Date().toISOString();
  const { data: upcoming } = await sb
    .from("classes")
    .select("id, group_id, scheduled_at, duration_minutes, title, status")
    .in("group_id", groupIds)
    .gte("scheduled_at", nowIso)
    .in("status", ["scheduled", "live"])
    .order("scheduled_at", { ascending: true })
    .limit(50);

  const upcomingByGroup = new Map<string, UpcomingClassLite[]>();
  for (const c of (upcoming ?? []) as Array<UpcomingClassLite & { group_id: string }>) {
    const list = upcomingByGroup.get(c.group_id) ?? [];
    if (list.length < 3) {
      list.push({
        id:               c.id,
        scheduled_at:     c.scheduled_at,
        duration_minutes: c.duration_minutes,
        title:            c.title,
        status:           c.status,
      });
      upcomingByGroup.set(c.group_id, list);
    }
  }

  // Latest recording per group: join recordings → classes → group, only
  // pick status='ready' with a file_url.
  const { data: recs } = await sb
    .from("recordings")
    .select(`
      id, file_url, duration_seconds, status, created_at,
      class:classes!inner(id, title, scheduled_at, group_id)
    `)
    .eq("status", "ready")
    .not("file_url", "is", null)
    .order("created_at", { ascending: false })
    .limit(200);

  const latestByGroup = new Map<string, RecordingLite>();
  type RecRow = {
    id: string; file_url: string | null; duration_seconds: number | null;
    status: string; created_at: string;
    class: { id: string; title: string; scheduled_at: string; group_id: string | null } |
           Array<{ id: string; title: string; scheduled_at: string; group_id: string | null }>;
  };
  for (const r of (recs ?? []) as unknown as RecRow[]) {
    const c = Array.isArray(r.class) ? r.class[0] : r.class;
    if (!c?.group_id) continue;
    if (latestByGroup.has(c.group_id)) continue;          // already have the latest for this group
    latestByGroup.set(c.group_id, {
      id:           r.id,
      class_id:     c.id,
      class_title:  c.title,
      class_date:   c.scheduled_at,
      file_url:     r.file_url,
      duration_sec: r.duration_seconds,
      status:       r.status,
    });
  }

  return groupRows.map(raw => {
    const r = raw as Record<string, unknown>;
    const t = r.teacher as Record<string, unknown> | Record<string, unknown>[] | null;
    const tf = Array.isArray(t) ? t[0] : t;
    const u = tf?.users as Record<string, unknown> | Record<string, unknown>[];
    const uf = Array.isArray(u) ? u[0] : u;

    type MemberRow = { student:
      | { id: string; current_level: string | null;
          users: { full_name: string | null; email: string } | Array<{ full_name: string | null; email: string }>; }
      | Array<{ id: string; current_level: string | null;
          users: { full_name: string | null; email: string } | Array<{ full_name: string | null; email: string }>; }>;
    };
    const rawMembers = (r.student_group_members as MemberRow[] | undefined) ?? [];
    const members: GroupMemberLite[] = rawMembers.flatMap(m => {
      const s = Array.isArray(m.student) ? m.student[0] : m.student;
      if (!s) return [];
      const su = Array.isArray(s.users) ? s.users[0] : s.users;
      return [{
        student_id: s.id,
        full_name:  su?.full_name ?? null,
        email:      su?.email ?? "",
        level:      s.current_level ?? null,
      }];
    }).sort((a, b) => (a.full_name ?? a.email).localeCompare(b.full_name ?? b.email));

    const groupId = r.id as string;
    const levelsRaw = r.levels;
    const levels: CefrLevel[] = Array.isArray(levelsRaw)
      ? (levelsRaw as CefrLevel[])
      : (r.level ? [r.level as CefrLevel] : []);
    return {
      id:           groupId,
      name:         r.name as string,
      class_type:   (r.class_type as "group" | "individual"),
      level:        (r.level as string | null) ?? null,
      levels,
      teacher_id:   (r.teacher_id as string | null) ?? null,
      start_date:   (r.start_date as string | null) ?? null,
      end_date:     (r.end_date as string | null) ?? null,
      capacity:     (r.capacity as number | null) ?? null,
      meet_link:    (r.meet_link as string | null) ?? null,
      document_url: (r.document_url as string | null) ?? null,
      active:       Boolean(r.active),
      notes:        (r.notes as string | null) ?? null,
      created_at:   r.created_at as string,
      teacher_name: (uf?.full_name as string | null) ?? null,
      members,
      upcoming_classes: upcomingByGroup.get(groupId) ?? [],
      latest_recording: latestByGroup.get(groupId) ?? null,
    };
  });
}

/**
 * Lookup a single group by id. Same shape as StudentGroupRow. Used by
 * edit modals to avoid re-hydrating the full admin listing.
 */
export async function getStudentGroupById(id: string): Promise<StudentGroupRow | null> {
  const sb = supabaseAdmin();
  const { data } = await sb
    .from("student_groups")
    .select(`
      id, name, class_type, level, levels, teacher_id, start_date, end_date,
      capacity, meet_link, document_url, active, notes, created_at
    `)
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  const r = data as Record<string, unknown>;
  const levelsRaw = r.levels;
  const levels: CefrLevel[] = Array.isArray(levelsRaw)
    ? (levelsRaw as CefrLevel[])
    : (r.level ? [r.level as CefrLevel] : []);
  return {
    id:           r.id as string,
    name:         r.name as string,
    class_type:   r.class_type as "group" | "individual",
    level:        (r.level as string | null) ?? null,
    levels,
    teacher_id:   (r.teacher_id as string | null) ?? null,
    start_date:   (r.start_date as string | null) ?? null,
    end_date:     (r.end_date as string | null) ?? null,
    capacity:     (r.capacity as number | null) ?? null,
    meet_link:    (r.meet_link as string | null) ?? null,
    document_url: (r.document_url as string | null) ?? null,
    active:       Boolean(r.active),
    notes:        (r.notes as string | null) ?? null,
    created_at:   r.created_at as string,
  };
}
