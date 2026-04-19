import { supabaseAdmin } from "./supabase";

/**
 * Count consecutive recent classes where the student was marked
 * `attended = true`. A class with attended=false or attended=null
 * (not yet marked) breaks the streak. We only look at classes whose
 * scheduled_at is in the past, status='completed' or 'absent' — so
 * the streak reflects facts on record, not future classes.
 *
 * Returns { current, best, lastClassAt }. `best` is the all-time
 * longest streak, useful for a "best 12 🔥" sub-label.
 */
export type StreakResult = {
  current:     number;
  best:        number;
  lastClassAt: string | null;
};

export async function getAttendanceStreakForStudent(
  studentId: string,
): Promise<StreakResult> {
  const sb = supabaseAdmin();
  const { data } = await sb
    .from("class_participants")
    .select(`
      attended,
      class:classes!inner(scheduled_at, status)
    `)
    .eq("student_id", studentId)
    .lt("class.scheduled_at", new Date().toISOString())
    .in("class.status", ["completed", "absent"])
    .order("class(scheduled_at)", { ascending: false })
    .limit(200);

  type Row = {
    attended: boolean | null;
    class: { scheduled_at: string; status: string } | Array<{ scheduled_at: string; status: string }>;
  };
  const rows = ((data ?? []) as Row[]).map(r => {
    const c = Array.isArray(r.class) ? r.class[0] : r.class;
    return { attended: r.attended, scheduled_at: c?.scheduled_at ?? null };
  }).filter(r => r.scheduled_at);

  // Current streak: count from the most recent row while attended=true.
  let current = 0;
  let lastClassAt: string | null = null;
  for (const r of rows) {
    if (r.attended === true) {
      current++;
      if (!lastClassAt) lastClassAt = r.scheduled_at;
    } else {
      break;   // first non-true breaks the chain
    }
  }

  // Best streak: longest consecutive run of attended=true in the window.
  let best = 0, run = 0;
  for (const r of rows) {
    if (r.attended === true) {
      run++;
      if (run > best) best = run;
    } else {
      run = 0;
    }
  }
  // If current is larger than best (e.g. window truncation), prefer current.
  if (current > best) best = current;

  return { current, best, lastClassAt };
}
