/**
 * Schedule generator — turns a high-level ScheduleSpec (the user's
 * selection in the Create-group wizard) into a flat list of
 * `{scheduledAtIso, durationMin}` entries the back-end can insert as
 * `classes` rows.
 *
 * Five modes, picked to match Zoom's mental model:
 *
 *   - "weekly_days"   — N sessions on the chosen weekdays (Mon-Sun)
 *                       at a single start time. e.g. Tue+Thu 15:00.
 *   - "biweekly_days" — same, but every other week.
 *   - "monthly_day"   — same day-of-month each month.
 *   - "custom_dates"  — explicit list of (date, time, duration) entries.
 *   - "single"        — one-off class.
 *
 * All wall-clock times are interpreted in Europe/Berlin and converted
 * to UTC ISO. The output is timezone-correct regardless of where the
 * caller runs (client browser or Vercel serverless).
 */

const BERLIN_TZ = "Europe/Berlin";

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;   // 0 = Sunday … 6 = Saturday

export type ScheduleSpec =
  | {
      mode:           "weekly_days";
      weekdays:       Weekday[];                        // at least one
      time:           string;                            // "HH:MM"
      durationMin:    number;
      totalSessions:  number;                            // how many to generate
      firstDate:      string;                            // "YYYY-MM-DD" — earliest date considered
    }
  | {
      mode:           "biweekly_days";
      weekdays:       Weekday[];
      time:           string;
      durationMin:    number;
      totalSessions:  number;
      firstDate:      string;
    }
  | {
      mode:           "monthly_day";
      dayOfMonth:     number;                            // 1-31
      time:           string;
      durationMin:    number;
      totalSessions:  number;
      firstDate:      string;
    }
  | {
      mode:    "custom_dates";
      entries: Array<{ date: string; time: string; durationMin: number }>;
    }
  | {
      mode:        "single";
      date:        string;
      time:        string;
      durationMin: number;
    };

export type ScheduleEntry = {
  scheduledAtIso: string;     // UTC ISO 8601
  durationMin:    number;
};

/** Hard cap so a typo (e.g. 9999 sessions) doesn't blow up the DB. */
export const MAX_SESSIONS_PER_SCHEDULE = 500;

export function generateSchedule(spec: ScheduleSpec): ScheduleEntry[] {
  switch (spec.mode) {
    case "single":
      return [{
        scheduledAtIso: berlinWallClockToIso(spec.date, spec.time),
        durationMin:    spec.durationMin,
      }];

    case "custom_dates": {
      const entries = spec.entries
        .map(e => ({
          scheduledAtIso: berlinWallClockToIso(e.date, e.time),
          durationMin:    e.durationMin,
        }))
        .sort((a, b) => a.scheduledAtIso.localeCompare(b.scheduledAtIso));
      return entries.slice(0, MAX_SESSIONS_PER_SCHEDULE);
    }

    case "weekly_days":
      return generateRecurring(spec, 1);

    case "biweekly_days":
      return generateRecurring(spec, 2);

    case "monthly_day":
      return generateMonthly(spec);
  }
}

// ─────────────────────────────────────────────────────────
// Mode-specific helpers
// ─────────────────────────────────────────────────────────

function generateRecurring(
  spec: Extract<ScheduleSpec, { mode: "weekly_days" | "biweekly_days" }>,
  weekStride: 1 | 2,
): ScheduleEntry[] {
  if (spec.weekdays.length === 0) return [];
  const total = Math.min(spec.totalSessions, MAX_SESSIONS_PER_SCHEDULE);
  if (total <= 0) return [];

  const entries: ScheduleEntry[] = [];
  // Walk forward day by day from `firstDate`. Skip weeks per stride.
  // We use UTC date math for the cursor — the wall-clock conversion
  // happens once per emitted entry.
  const start = parseLocalDate(spec.firstDate);
  let weekOffset = 0;          // 0 for the first emitted week
  const cursor   = new Date(start);
  // Anchor week: the ISO week containing `firstDate`.
  // We keep emitting until we have `total` entries. The biweekly
  // stride is enforced by checking weekOffset % 2 === 0.
  // Loop limit so a misconfig never spins forever.
  for (let safety = 0; safety < total * 7 * weekStride + 14; safety++) {
    const dow = cursor.getUTCDay() as Weekday;
    const weekStartOk = weekStride === 1 || weekOffset % weekStride === 0;
    if (weekStartOk && spec.weekdays.includes(dow)) {
      const dateStr = isoDate(cursor);
      entries.push({
        scheduledAtIso: berlinWallClockToIso(dateStr, spec.time),
        durationMin:    spec.durationMin,
      });
      if (entries.length >= total) break;
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    // When we cross a Monday boundary, increment weekOffset.
    if (cursor.getUTCDay() === 1) weekOffset++;
  }
  return entries;
}

function generateMonthly(
  spec: Extract<ScheduleSpec, { mode: "monthly_day" }>,
): ScheduleEntry[] {
  const total = Math.min(spec.totalSessions, MAX_SESSIONS_PER_SCHEDULE);
  if (total <= 0) return [];

  const start = parseLocalDate(spec.firstDate);
  const entries: ScheduleEntry[] = [];

  // Move forward from the first month that can host `dayOfMonth` >=
  // start's day. If the start is, say, May 2026 and dayOfMonth is 6
  // but start is May 7, the first session is June 6.
  let year  = start.getUTCFullYear();
  let month = start.getUTCMonth();   // 0-indexed
  const startDay = start.getUTCDate();
  if (spec.dayOfMonth < startDay) {
    month += 1;
    if (month > 11) { month = 0; year += 1; }
  }

  for (let i = 0; i < total; i++) {
    // Months can have fewer than 31 days; clamp to last valid day.
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const day         = Math.min(spec.dayOfMonth, daysInMonth);
    const dateStr     = `${year}-${pad(month + 1)}-${pad(day)}`;
    entries.push({
      scheduledAtIso: berlinWallClockToIso(dateStr, spec.time),
      durationMin:    spec.durationMin,
    });
    month += 1;
    if (month > 11) { month = 0; year += 1; }
  }
  return entries;
}

// ─────────────────────────────────────────────────────────
// Berlin-TZ helpers
// ─────────────────────────────────────────────────────────

/**
 * Build an ISO timestamp from a Berlin wall-clock (date, time).
 * "2026-05-06" + "10:00" → "2026-05-06T08:00:00.000Z" in summer
 *                       → "2026-05-06T09:00:00.000Z" in winter
 */
export function berlinWallClockToIso(dateYmd: string, hhmm: string): string {
  const [Y, M, D] = dateYmd.split("-").map(Number);
  const [h, mi]   = hhmm.split(":").map(Number);
  // First guess: treat the wall clock as if it were UTC, then shift back
  // by Berlin's offset on that approximate instant.
  const guessUtcMs = Date.UTC(Y, M - 1, D, h, mi);
  const offsetMin  = berlinOffsetMinutes(new Date(guessUtcMs));
  return new Date(guessUtcMs - offsetMin * 60_000).toISOString();
}

function berlinOffsetMinutes(d: Date): number {
  // Difference between Berlin local and UTC, in minutes.
  const utcMs    = d.getTime();
  const berlinStr = d.toLocaleString("en-US", { timeZone: BERLIN_TZ });
  const berlinMs = new Date(berlinStr).getTime();
  return Math.round((berlinMs - utcMs) / 60_000);
}

function parseLocalDate(ymd: string): Date {
  const [Y, M, D] = ymd.split("-").map(Number);
  return new Date(Date.UTC(Y, M - 1, D));
}

function isoDate(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function pad(n: number): string { return String(n).padStart(2, "0"); }
