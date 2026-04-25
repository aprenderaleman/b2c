import { supabaseAdmin } from "./supabase";

/**
 * Trial-slot computation for the public funnel.
 *
 * Algorithm:
 *   1. Pull every active teacher with `accepts_trials = true`. This
 *      is the rotation pool. If empty → no slots.
 *   2. For each pool teacher, fetch their weekly `teacher_availability`
 *      windows + every `scheduled` / `live` class in the lookahead
 *      horizon (45 min apart from `now`).
 *   3. For each Berlin-day in the horizon (skip Sundays — Gelfis's
 *      `skip_sundays` rule applies to trials too), walk each
 *      teacher's availability windows for that weekday and carve out
 *      45-min blocks that don't overlap any of their existing classes.
 *   4. Aggregate the resulting candidate slots across teachers and
 *      bucket by exact ISO timestamp. Each timestamp picks the
 *      "rotation winner" — the eligible teacher with the FEWEST
 *      trial classes in the last 30 days. Ties broken by least
 *      recent trial.
 *   5. Cap the response at 60 slots so the UI stays snappy.
 *
 * Returns an empty array if the 14-day window is dry; the caller can
 * extend to 30 days (per spec) by passing `horizonDays = 30`.
 */

const BERLIN_TZ = "Europe/Berlin";
const DEFAULT_HORIZON_DAYS = 14;
const EXTENDED_HORIZON_DAYS = 30;
const TRIAL_MINUTES = 45;
const SLOT_GRANULARITY_MIN = 15;            // start times every :00 :15 :30 :45
const MIN_LEAD_TIME_HOURS = 2;              // can't book within 2h of now
const MAX_RESULTS = 60;

export type TrialSlot = {
  startIso:    string;            // exact UTC ISO start
  teacherId:   string;
  teacherName: string;
};

type AvailabilityRow = {
  teacher_id:   string;
  day_of_week:  number;            // 0 (Sun) — 6 (Sat)
  start_time:   string;            // "09:00:00"
  end_time:     string;            // "18:00:00"
  available:    boolean;
  valid_from:   string | null;
  valid_until:  string | null;
};

type TeacherRow = {
  id:           string;
  user_id:      string;
  full_name:    string | null;
  email:        string;
  trial_count_30d: number;
  last_trial_at:   string | null;
};

/**
 * Public entrypoint for the funnel.
 * Returns up to MAX_RESULTS upcoming free slots. Auto-extends from 14
 * to 30 days if the shorter window came up empty.
 */
export async function listTrialSlots(): Promise<TrialSlot[]> {
  const first = await computeSlots(DEFAULT_HORIZON_DAYS);
  if (first.length > 0) return first;
  return computeSlots(EXTENDED_HORIZON_DAYS);
}

async function computeSlots(horizonDays: number): Promise<TrialSlot[]> {
  const sb = supabaseAdmin();
  const now = new Date();
  const earliestStart = new Date(now.getTime() + MIN_LEAD_TIME_HOURS * 3600_000);
  const horizonEnd = new Date(now.getTime() + horizonDays * 24 * 3600_000);

  // 1. Eligible teachers + per-teacher load (last 30 days of trial classes).
  const since30 = new Date(now.getTime() - 30 * 24 * 3600_000).toISOString();

  const { data: rawTeachers } = await sb
    .from("teachers")
    .select(`
      id, user_id, active, accepts_trials,
      users!inner(full_name, email, active)
    `)
    .eq("accepts_trials", true)
    .eq("active", true)
    .eq("users.active", true);

  type TeacherRaw = {
    id: string; user_id: string;
    users: { full_name: string | null; email: string } |
           Array<{ full_name: string | null; email: string }>;
  };
  const teacherList = ((rawTeachers ?? []) as TeacherRaw[]).map(r => {
    const u = Array.isArray(r.users) ? r.users[0] : r.users;
    return {
      id:        r.id,
      user_id:   r.user_id,
      full_name: u?.full_name ?? null,
      email:     u?.email ?? "",
    };
  });
  if (teacherList.length === 0) return [];

  const teacherIds = teacherList.map(t => t.id);

  // Trial counts in last 30d for rotation tiebreak.
  const { data: trialStats } = await sb
    .from("classes")
    .select("teacher_id, scheduled_at")
    .eq("is_trial", true)
    .in("status", ["scheduled", "live", "completed"])
    .in("teacher_id", teacherIds)
    .gte("scheduled_at", since30);
  const stats = new Map<string, { count: number; latestIso: string }>();
  for (const r of (trialStats ?? []) as Array<{ teacher_id: string; scheduled_at: string }>) {
    const cur = stats.get(r.teacher_id) ?? { count: 0, latestIso: "" };
    cur.count += 1;
    if (r.scheduled_at > cur.latestIso) cur.latestIso = r.scheduled_at;
    stats.set(r.teacher_id, cur);
  }

  const teachers: TeacherRow[] = teacherList.map(t => ({
    ...t,
    trial_count_30d: stats.get(t.id)?.count ?? 0,
    last_trial_at:   stats.get(t.id)?.latestIso || null,
  }));

  // 2. Availability windows + existing scheduled classes for everyone in the pool.
  const [{ data: avail }, { data: existing }] = await Promise.all([
    sb.from("teacher_availability")
      .select("teacher_id, day_of_week, start_time, end_time, available, valid_from, valid_until")
      .in("teacher_id", teacherIds)
      .eq("available", true),
    sb.from("classes")
      .select("teacher_id, scheduled_at, duration_minutes")
      .in("teacher_id", teacherIds)
      .in("status", ["scheduled", "live"])
      .gte("scheduled_at", now.toISOString())
      .lte("scheduled_at", horizonEnd.toISOString()),
  ]);

  const availByTeacher = new Map<string, AvailabilityRow[]>();
  for (const r of (avail ?? []) as AvailabilityRow[]) {
    const list = availByTeacher.get(r.teacher_id) ?? [];
    list.push(r);
    availByTeacher.set(r.teacher_id, list);
  }

  type Busy = { startMs: number; endMs: number };
  const busyByTeacher = new Map<string, Busy[]>();
  for (const r of (existing ?? []) as Array<{ teacher_id: string; scheduled_at: string; duration_minutes: number }>) {
    const startMs = new Date(r.scheduled_at).getTime();
    const list = busyByTeacher.get(r.teacher_id) ?? [];
    list.push({ startMs, endMs: startMs + r.duration_minutes * 60_000 });
    busyByTeacher.set(r.teacher_id, list);
  }

  // 3. Walk each Berlin-day in the horizon, accumulating candidate slots
  //    per teacher.
  type Candidate = { startMs: number; teacher: TeacherRow };
  const candidates: Candidate[] = [];

  const dayCount = horizonDays;
  for (let i = 0; i < dayCount; i++) {
    // Get the Berlin date `i` days from now.
    const dayDate = new Date(now.getTime() + i * 24 * 3600_000);
    const berlinDow = berlinDayOfWeek(dayDate);
    if (berlinDow === 0) continue;                // skip Sundays

    for (const teacher of teachers) {
      const windows = (availByTeacher.get(teacher.id) ?? [])
        .filter(w => w.day_of_week === berlinDow)
        .filter(w => isWindowValid(w, dayDate));

      for (const w of windows) {
        // For each 15-min start time in [w.start_time, w.end_time - 45min)
        const winStartMs = berlinClockToUtcMs(dayDate, w.start_time);
        const winEndMs   = berlinClockToUtcMs(dayDate, w.end_time);
        const lastValidStart = winEndMs - TRIAL_MINUTES * 60_000;

        for (let t = winStartMs; t <= lastValidStart; t += SLOT_GRANULARITY_MIN * 60_000) {
          if (t < earliestStart.getTime()) continue;
          const slotEnd = t + TRIAL_MINUTES * 60_000;

          // Reject if it overlaps any of this teacher's existing classes.
          const busy = busyByTeacher.get(teacher.id) ?? [];
          const collision = busy.some(b => t < b.endMs && slotEnd > b.startMs);
          if (collision) continue;

          candidates.push({ startMs: t, teacher });
        }
      }
    }
  }

  if (candidates.length === 0) return [];

  // 4. Bucket by exact start time and pick the rotation winner per bucket.
  type Bucket = { startMs: number; teachers: TeacherRow[] };
  const buckets = new Map<number, Bucket>();
  for (const c of candidates) {
    const b = buckets.get(c.startMs);
    if (b) {
      if (!b.teachers.find(t => t.id === c.teacher.id)) b.teachers.push(c.teacher);
    } else {
      buckets.set(c.startMs, { startMs: c.startMs, teachers: [c.teacher] });
    }
  }

  const sortedBuckets = [...buckets.values()].sort((a, b) => a.startMs - b.startMs);

  const slots: TrialSlot[] = [];
  for (const b of sortedBuckets) {
    if (slots.length >= MAX_RESULTS) break;
    // Pick the teacher with the fewest trials in the last 30d; ties → least
    // recent trial; then alphabetical for determinism.
    const winner = [...b.teachers].sort((a, b) => {
      if (a.trial_count_30d !== b.trial_count_30d) return a.trial_count_30d - b.trial_count_30d;
      const al = a.last_trial_at ?? "";
      const bl = b.last_trial_at ?? "";
      if (al !== bl) return al.localeCompare(bl);
      const an = a.full_name ?? a.email;
      const bn = b.full_name ?? b.email;
      return an.localeCompare(bn);
    })[0];

    slots.push({
      startIso:    new Date(b.startMs).toISOString(),
      teacherId:   winner.id,
      teacherName: winner.full_name ?? winner.email,
    });
  }
  return slots;
}

// ─────────────────────────────────────────────────────────
// Berlin TZ helpers — naive implementations using the
// Intl.DateTimeFormat API; good enough for the +1/+2 offset
// jumps that affect this app.
// ─────────────────────────────────────────────────────────

function berlinDayOfWeek(d: Date): number {
  // 0=Sun … 6=Sat in the Berlin calendar.
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: BERLIN_TZ, weekday: "short",
  });
  const map: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  return map[fmt.format(d)] ?? 0;
}

/** Convert a "clock time in Berlin on the same date as `anchor`" → UTC ms. */
function berlinClockToUtcMs(anchor: Date, hhmmss: string): number {
  const [hh, mm] = hhmmss.split(":").map(s => parseInt(s, 10));
  // Pull the Berlin Y/M/D for the anchor.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BERLIN_TZ,
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(anchor);
  const y = parts.find(p => p.type === "year")!.value;
  const m = parts.find(p => p.type === "month")!.value;
  const d = parts.find(p => p.type === "day")!.value;
  // Build a "Berlin local" datetime by appending the offset Berlin had
  // on that date. Cheap trick: format an anchor at midnight local in
  // Berlin and compare to UTC to derive the offset.
  const offset = berlinOffsetMinutes(new Date(`${y}-${m}-${d}T12:00:00Z`));
  const sign = offset >= 0 ? "+" : "-";
  const oh = String(Math.floor(Math.abs(offset) / 60)).padStart(2, "0");
  const om = String(Math.abs(offset) % 60).padStart(2, "0");
  const iso = `${y}-${m}-${d}T${String(hh).padStart(2,"0")}:${String(mm).padStart(2,"0")}:00${sign}${oh}:${om}`;
  return new Date(iso).getTime();
}

function berlinOffsetMinutes(d: Date): number {
  // Difference between UTC and Berlin local at this instant, in minutes.
  const utc = d.getTime();
  const berlinNow = new Date(d.toLocaleString("en-US", { timeZone: BERLIN_TZ }));
  const utcNow    = new Date(d.toLocaleString("en-US", { timeZone: "UTC" }));
  return Math.round((berlinNow.getTime() - utcNow.getTime()) / 60_000);
}

function isWindowValid(w: AvailabilityRow, day: Date): boolean {
  const dayIso = day.toISOString().slice(0, 10);
  if (w.valid_from   && dayIso < w.valid_from)  return false;
  if (w.valid_until  && dayIso > w.valid_until) return false;
  return true;
}
