import { supabaseAdmin } from "./supabase";

// =============================================================================
// Types
// =============================================================================

export type PaymentRow = {
  id:            string;
  student_id:    string;
  amount_cents:  number;
  currency:      string;
  type:          "single_class" | "package" | "subscription_payment" | "other";
  status:        "pending" | "paid" | "failed" | "refunded";
  classes_added: number;
  invoice_url:   string | null;
  note:          string | null;
  paid_at:       string | null;
  created_at:    string;
  student_name:  string | null;
  student_email: string;
};

export type TeacherMonthlyEarnings = {
  id:                string | null;
  teacher_id:        string;
  month:             string;             // "YYYY-MM-01"
  total_minutes:     number;
  classes_count:     number;
  amount_cents:      number;
  currency:          string;
  paid:              boolean;
  paid_at:           string | null;
  payment_reference: string | null;
  locked:            boolean;
};

// =============================================================================
// Log hours after a class ends + recompute the monthly rollup
// =============================================================================

/**
 * Called from /api/aula/[id]/end after a class gets its actual_duration
 * confirmed. Inserts one class_hours_log row + upserts the monthly
 * teacher_earnings aggregate. Idempotent on class_id.
 */
export async function logClassHoursAndRollup(args: {
  classId:          string;
  teacherId:        string;
  durationMinutes:  number;
}): Promise<void> {
  const sb = supabaseAdmin();

  // Snapshot the teacher's current rate so a later change doesn't rewrite
  // the past. A teacher without a rate set is logged at 0 — admin can fix
  // later by editing rate + re-running a rollup.
  const { data: t } = await sb
    .from("teachers")
    .select("hourly_rate, currency")
    .eq("id", args.teacherId)
    .maybeSingle();

  const rateRaw    = (t as { hourly_rate: string | null } | null)?.hourly_rate;
  const currency   = ((t as { currency: string } | null)?.currency ?? "EUR");
  const rate       = rateRaw !== null && rateRaw !== undefined ? Number(rateRaw) : 0;
  const amountCents = Math.round((rate * args.durationMinutes / 60) * 100);

  // Insert the hours-log row. UNIQUE on class_id prevents double-logging
  // if the end-class endpoint is called twice.
  const { error: insErr } = await sb.from("class_hours_log").upsert(
    {
      class_id:         args.classId,
      teacher_id:       args.teacherId,
      duration_minutes: args.durationMinutes,
      rate_at_time:     rate,
      amount_cents:     amountCents,
      currency,
    },
    { onConflict: "class_id" },
  );
  if (insErr) {
    console.error("class_hours_log upsert failed:", insErr.message);
    return;
  }

  // Recompute this teacher's current-month earnings from truth.
  await rollupTeacherMonth(args.teacherId, new Date());
}

/**
 * Recompute teacher_earnings for (teacher, month-of-date) by summing
 * class_hours_log rows in that month. Upserts the row.
 */
export async function rollupTeacherMonth(
  teacherId: string,
  anyDateInMonth: Date,
): Promise<void> {
  const sb = supabaseAdmin();

  const monthStart = new Date(Date.UTC(
    anyDateInMonth.getUTCFullYear(),
    anyDateInMonth.getUTCMonth(),
    1, 0, 0, 0,
  ));
  const monthEnd = new Date(Date.UTC(
    anyDateInMonth.getUTCFullYear(),
    anyDateInMonth.getUTCMonth() + 1,
    1, 0, 0, 0,
  ));
  const monthDateStr = monthStart.toISOString().slice(0, 10);

  const { data: rows, error } = await sb
    .from("class_hours_log")
    .select("duration_minutes, amount_cents, currency")
    .eq("teacher_id", teacherId)
    .gte("created_at", monthStart.toISOString())
    .lt("created_at", monthEnd.toISOString());
  if (error) {
    console.error("rollup select failed:", error.message);
    return;
  }

  const totalMinutes  = (rows ?? []).reduce((s, r) => s + Number((r as { duration_minutes: number }).duration_minutes), 0);
  const amountCents   = (rows ?? []).reduce((s, r) => s + Number((r as { amount_cents: number }).amount_cents), 0);
  const classesCount  = (rows ?? []).length;
  const currency      = (rows?.[0] as { currency: string } | undefined)?.currency ?? "EUR";

  await sb.from("teacher_earnings").upsert(
    {
      teacher_id:   teacherId,
      month:        monthDateStr,
      total_minutes: totalMinutes,
      classes_count: classesCount,
      amount_cents:  amountCents,
      currency,
      // Preserve paid-state fields if the row already exists.
    },
    { onConflict: "teacher_id,month", ignoreDuplicates: false },
  );
}

// =============================================================================
// Queries for dashboards
// =============================================================================

export async function getTeacherEarningsSummary(teacherId: string, months = 6): Promise<TeacherMonthlyEarnings[]> {
  const sb = supabaseAdmin();
  const cutoff = new Date();
  cutoff.setUTCMonth(cutoff.getUTCMonth() - (months - 1));
  cutoff.setUTCDate(1);
  cutoff.setUTCHours(0, 0, 0, 0);

  const { data, error } = await sb
    .from("teacher_earnings")
    .select("id, teacher_id, month, total_minutes, classes_count, amount_cents, currency, paid, paid_at, payment_reference, locked")
    .eq("teacher_id", teacherId)
    .gte("month", cutoff.toISOString().slice(0, 10))
    .order("month", { ascending: false });
  if (error) return [];
  return (data ?? []) as TeacherMonthlyEarnings[];
}

export async function getAllEarningsForMonth(monthDate: Date): Promise<Array<TeacherMonthlyEarnings & {
  teacher_name: string | null;
  teacher_email: string;
}>> {
  const sb = supabaseAdmin();
  const monthStart = new Date(Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth(), 1));
  const monthStr   = monthStart.toISOString().slice(0, 10);

  const { data, error } = await sb
    .from("teacher_earnings")
    .select(`
      id, teacher_id, month, total_minutes, classes_count, amount_cents,
      currency, paid, paid_at, payment_reference, locked,
      teacher:teachers!inner(users!inner(full_name, email))
    `)
    .eq("month", monthStr)
    .order("amount_cents", { ascending: false });
  if (error) return [];

  return (data ?? []).map(r => {
    const t = (r as { teacher: unknown }).teacher;
    const tFlat = Array.isArray(t) ? t[0] : t;
    const u = (tFlat as { users: unknown } | null)?.users;
    const uu = (Array.isArray(u) ? u[0] : u) as { full_name: string | null; email: string } | undefined;
    return {
      id:               (r as { id: string }).id,
      teacher_id:       (r as { teacher_id: string }).teacher_id,
      month:            (r as { month: string }).month,
      total_minutes:    (r as { total_minutes: number }).total_minutes,
      classes_count:    (r as { classes_count: number }).classes_count,
      amount_cents:     (r as { amount_cents: number }).amount_cents,
      currency:         (r as { currency: string }).currency,
      paid:             Boolean((r as { paid: boolean }).paid),
      paid_at:          (r as { paid_at: string | null }).paid_at,
      payment_reference: (r as { payment_reference: string | null }).payment_reference,
      locked:           Boolean((r as { locked: boolean }).locked),
      teacher_name:     uu?.full_name ?? null,
      teacher_email:    uu?.email ?? "",
    };
  });
}

export async function getTotalRevenue(fromDate: Date, toDate: Date): Promise<{
  revenue_cents: number;
  by_type: Record<string, number>;
  payment_count: number;
  currency: string;
}> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("payments")
    .select("amount_cents, type, currency")
    .eq("status", "paid")
    .gte("paid_at", fromDate.toISOString())
    .lte("paid_at", toDate.toISOString());
  if (error) return { revenue_cents: 0, by_type: {}, payment_count: 0, currency: "EUR" };

  type Row = { amount_cents: number; type: string; currency: string };
  let revenue = 0;
  const byType: Record<string, number> = {};
  for (const r of (data ?? []) as Row[]) {
    revenue += Number(r.amount_cents);
    byType[r.type] = (byType[r.type] ?? 0) + Number(r.amount_cents);
  }
  return {
    revenue_cents: revenue,
    by_type:       byType,
    payment_count: (data ?? []).length,
    currency:      (data?.[0] as Row | undefined)?.currency ?? "EUR",
  };
}

export async function listStudentPayments(studentId: string): Promise<PaymentRow[]> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("payments")
    .select(`
      id, student_id, amount_cents, currency, type, status, classes_added,
      invoice_url, note, paid_at, created_at,
      student:students!inner(users!inner(full_name, email))
    `)
    .eq("student_id", studentId)
    .order("created_at", { ascending: false });
  if (error) return [];

  return (data ?? []).map(r => {
    const s = (r as { student: unknown }).student;
    const sFlat = Array.isArray(s) ? s[0] : s;
    const u = (sFlat as { users: unknown } | null)?.users;
    const uu = (Array.isArray(u) ? u[0] : u) as { full_name: string | null; email: string } | undefined;
    return {
      id:            (r as { id: string }).id,
      student_id:    (r as { student_id: string }).student_id,
      amount_cents:  (r as { amount_cents: number }).amount_cents,
      currency:      (r as { currency: string }).currency,
      type:          (r as { type: PaymentRow["type"] }).type,
      status:        (r as { status: PaymentRow["status"] }).status,
      classes_added: (r as { classes_added: number }).classes_added,
      invoice_url:   (r as { invoice_url: string | null }).invoice_url,
      note:          (r as { note: string | null }).note,
      paid_at:       (r as { paid_at: string | null }).paid_at,
      created_at:    (r as { created_at: string }).created_at,
      student_name:  uu?.full_name ?? null,
      student_email: uu?.email ?? "",
    };
  });
}

// =============================================================================
// Display helpers
// =============================================================================

export function moneyFromCents(cents: number, currency = "EUR"): string {
  return `${(cents / 100).toFixed(2)} ${currency}`;
}

export function formatMonthEs(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("es-ES", { month: "long", year: "numeric" });
}
