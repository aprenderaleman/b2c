import { supabaseAdmin } from "./supabase";
import { getTotalRevenue, getTotalExpenses, moneyFromCents } from "./finance";
import { stripeDE } from "./stripe";

// =============================================================================
// Types
// =============================================================================

export type EmpresaAlert = {
  severity: "red" | "green" | "amber";
  title: string;
  detail: string;
  recommendation: string;
};

export type FunnelMetrics = {
  leads_total: number;
  ads_conversions: number;
  trials_scheduled: number;
  trials_attended: number;
  conversions: number;
  conversions_real: number;
  rate_lead_to_trial: number;
  rate_trial_attendance: number;
  rate_attended_to_sale: number;
  rate_lead_to_sale: number;
  rate_real: number;
};

export type MarketingMetrics = {
  ads_spend_cents: number;
  cpl_real_cents: number;
  cac_cents: number;
  ltv_cents: number;
  ltv_cac_ratio: number;
  roas: number;
  has_ads_data: boolean;
};

export type DailyDataPoint = {
  date: string;
  leads: number;
  revenue_cents: number;
  expenses_cents: number;
};

export type RecentPayment = {
  id: string;
  student_name: string | null;
  student_email: string;
  amount_cents: number;
  currency: string;
  type: string;
  paid_at: string;
};

export type CosteFijo = {
  id: string;
  name: string;
  category: string;
  amount_cents: number;
  currency: string;
  active: boolean;
  starts_at: string;
  ends_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type EmpresaMetrics = {
  revenue_cents: number;
  revenue_by_type: Record<string, number>;
  teacher_payroll_cents: number;
  variable_expenses_cents: number;
  fixed_costs_cents: number;
  ads_spend_cents: number;
  beneficio_bruto_cents: number;
  beneficio_neto_cents: number;
  margen_bruto_pct: number;
  margen_neto_pct: number;
  funnel: FunnelMetrics;
  marketing: MarketingMetrics;
  alerts: EmpresaAlert[];
  daily: DailyDataPoint[];
  recent_payments: RecentPayment[];
  period: { from: string; to: string };
  prev_revenue_cents: number;
  prev_neto_cents: number;
  active_students: number;
};

// =============================================================================
// Period helpers
// =============================================================================

export type PeriodPreset = "today" | "3d" | "7d" | "30d" | "month" | "prev_month" | "year" | "custom";

export function resolvePeriod(
  preset: PeriodPreset,
  customFrom?: string,
  customTo?: string,
): { from: Date; to: Date; prevFrom: Date; prevTo: Date } {
  const now = new Date();
  const berlin = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Berlin" }));
  let from: Date;
  let to: Date;

  switch (preset) {
    case "today":
      from = new Date(Date.UTC(berlin.getFullYear(), berlin.getMonth(), berlin.getDate()));
      to = new Date(Date.UTC(berlin.getFullYear(), berlin.getMonth(), berlin.getDate(), 23, 59, 59));
      break;
    case "3d":
      to = new Date(Date.UTC(berlin.getFullYear(), berlin.getMonth(), berlin.getDate(), 23, 59, 59));
      from = new Date(to.getTime() - 2 * 86_400_000);
      from.setUTCHours(0, 0, 0, 0);
      break;
    case "7d":
      to = new Date(Date.UTC(berlin.getFullYear(), berlin.getMonth(), berlin.getDate(), 23, 59, 59));
      from = new Date(to.getTime() - 6 * 86_400_000);
      from.setUTCHours(0, 0, 0, 0);
      break;
    case "30d":
      to = new Date(Date.UTC(berlin.getFullYear(), berlin.getMonth(), berlin.getDate(), 23, 59, 59));
      from = new Date(to.getTime() - 29 * 86_400_000);
      from.setUTCHours(0, 0, 0, 0);
      break;
    case "month":
      from = new Date(Date.UTC(berlin.getFullYear(), berlin.getMonth(), 1));
      to = new Date(Date.UTC(berlin.getFullYear(), berlin.getMonth() + 1, 0, 23, 59, 59));
      break;
    case "prev_month":
      from = new Date(Date.UTC(berlin.getFullYear(), berlin.getMonth() - 1, 1));
      to = new Date(Date.UTC(berlin.getFullYear(), berlin.getMonth(), 0, 23, 59, 59));
      break;
    case "year":
      from = new Date(Date.UTC(berlin.getFullYear(), 0, 1));
      to = new Date(Date.UTC(berlin.getFullYear(), berlin.getMonth(), berlin.getDate(), 23, 59, 59));
      break;
    case "custom":
      from = customFrom ? new Date(customFrom + "T00:00:00Z") : new Date(Date.UTC(berlin.getFullYear(), berlin.getMonth(), 1));
      to = customTo ? new Date(customTo + "T23:59:59Z") : new Date(Date.UTC(berlin.getFullYear(), berlin.getMonth() + 1, 0, 23, 59, 59));
      break;
  }

  const durationMs = to.getTime() - from.getTime();
  const prevTo = new Date(from.getTime() - 1);
  const prevFrom = new Date(prevTo.getTime() - durationMs);

  return { from, to, prevFrom, prevTo };
}

// =============================================================================
// Main query
// =============================================================================

export async function getEmpresaMetrics(
  from: Date,
  to: Date,
  prevFrom: Date,
  prevTo: Date,
): Promise<EmpresaMetrics> {
  const sb = supabaseAdmin();

  const [
    revenue,
    prevRevenue,
    expenses,
    earnings,
    fixedCosts,
    funnel,
    prevFunnel,
    dailyLeads,
    dailyPayments,
    recentPayments,
    activeStudents,
    ltv,
    adsSpend,
    googleAdsSpend,
    googleAdsConversions,
    newClients,
  ] = await Promise.all([
    getTotalRevenue(from, to),
    getTotalRevenue(prevFrom, prevTo),
    getTotalExpenses(from, to),
    getTeacherPayrollForRange(sb, from, to),
    getFixedCostsForRange(sb, from, to),
    getFunnelMetrics(sb, from, to),
    getFunnelMetrics(sb, prevFrom, prevTo),
    getDailyLeads(sb, from, to),
    getDailyPayments(sb, from, to),
    getRecentPayments(sb, 20),
    countActiveStudents(sb),
    getAverageLTV(sb),
    getAdsSpendFromExpenses(sb, from, to),
    getGoogleAdsSpend(sb, from, to),
    getGoogleAdsConversions(sb, from, to),
    getNewClientsMetrics(sb, from, to),
  ]);

  // Inject Google Ads conversions into funnel for real conversion rate
  if (googleAdsConversions > 0) {
    funnel.ads_conversions = googleAdsConversions;
    funnel.rate_real = (funnel.conversions_real / googleAdsConversions) * 100;
  }

  const teacherPayrollCents = earnings;
  const fixedCostsCents = fixedCosts;
  // Prefer Google Ads API data when available, fall back to manual expenses
  const adsSpendCents = googleAdsSpend > 0 ? googleAdsSpend : adsSpend;
  // Exclude ads from variable expenses to avoid double-counting
  const variableExpensesCents = expenses.total_cents - adsSpend;

  const beneficioBrutoCents = revenue.revenue_cents - teacherPayrollCents;
  const beneficioNetoCents = beneficioBrutoCents - variableExpensesCents - fixedCostsCents - adsSpendCents;
  const margenBrutoPct = revenue.revenue_cents > 0
    ? (beneficioBrutoCents / revenue.revenue_cents) * 100
    : 0;
  const margenNetoPct = revenue.revenue_cents > 0
    ? (beneficioNetoCents / revenue.revenue_cents) * 100
    : 0;

  // CPL = cost per deposit (Google Ads "conversions" are €10 deposits, not pack sales)
  const cplRealCents = googleAdsConversions > 0
    ? Math.round(adsSpendCents / googleAdsConversions)
    : (funnel.leads_total > 0 ? Math.round(adsSpendCents / funnel.leads_total) : 0);
  // CAC = ads / new clients acquired (first Stripe payment in period)
  const cacCents = newClients.new_clients > 0
    ? Math.round(adsSpendCents / newClients.new_clients)
    : 0;
  // LTV = revenue from new clients / number of new clients
  const ltvFromNewClients = newClients.new_clients > 0
    ? Math.round(newClients.new_client_revenue_cents / newClients.new_clients)
    : ltv;
  const ltvCacRatio = cacCents > 0 ? ltvFromNewClients / cacCents : 0;
  // ROAS = new client revenue / ads spend (excludes recurring pre-existing clients)
  const roas = adsSpendCents > 0 ? newClients.new_client_revenue_cents / adsSpendCents : 0;

  const marketing: MarketingMetrics = {
    ads_spend_cents: adsSpendCents,
    cpl_real_cents: cplRealCents,
    cac_cents: cacCents,
    ltv_cents: ltvFromNewClients,
    ltv_cac_ratio: ltvCacRatio,
    roas,
    has_ads_data: adsSpendCents > 0,
  };

  const prevNetoCents = prevRevenue.revenue_cents - earnings - variableExpensesCents - fixedCostsCents - adsSpendCents;

  const daily = mergeDailyData(dailyLeads, dailyPayments, from, to);

  const alerts = computeAlerts(margenNetoPct, cacCents, ltvFromNewClients, roas, funnel);

  return {
    revenue_cents: revenue.revenue_cents,
    revenue_by_type: revenue.by_type,
    teacher_payroll_cents: teacherPayrollCents,
    variable_expenses_cents: variableExpensesCents,
    fixed_costs_cents: fixedCostsCents,
    ads_spend_cents: adsSpendCents,
    beneficio_bruto_cents: beneficioBrutoCents,
    beneficio_neto_cents: beneficioNetoCents,
    margen_bruto_pct: margenBrutoPct,
    margen_neto_pct: margenNetoPct,
    funnel,
    marketing,
    alerts,
    daily,
    recent_payments: recentPayments,
    period: { from: from.toISOString(), to: to.toISOString() },
    prev_revenue_cents: prevRevenue.revenue_cents,
    prev_neto_cents: prevNetoCents,
    active_students: newClients.total_unique_clients || activeStudents,
  };
}

// =============================================================================
// Sub-queries
// =============================================================================

type SB = ReturnType<typeof supabaseAdmin>;

async function getTeacherPayrollForRange(sb: SB, from: Date, to: Date): Promise<number> {
  const fromDate = from.toISOString().slice(0, 10);
  const toDate = to.toISOString().slice(0, 10);
  const { data } = await sb
    .from("teacher_earnings")
    .select("amount_cents")
    .gte("month", fromDate)
    .lte("month", toDate);
  return (data ?? []).reduce((s, r) => s + Number((r as { amount_cents: number }).amount_cents), 0);
}

async function getFixedCostsForRange(sb: SB, from: Date, to: Date): Promise<number> {
  const fromDate = from.toISOString().slice(0, 10);
  const toDate = to.toISOString().slice(0, 10);

  const { data } = await sb
    .from("costes_fijos")
    .select("amount_cents")
    .eq("active", true)
    .lte("starts_at", toDate)
    .or(`ends_at.is.null,ends_at.gte.${fromDate}`);

  if (!data || data.length === 0) return 0;

  const daysInRange = Math.max(1, Math.ceil((to.getTime() - from.getTime()) / 86_400_000));
  const totalMonthly = (data as Array<{ amount_cents: number }>).reduce(
    (s, r) => s + r.amount_cents, 0,
  );
  return Math.round(totalMonthly * (daysInRange / 30));
}

async function getFunnelMetrics(sb: SB, from: Date, to: Date): Promise<FunnelMetrics> {
  const fromISO = from.toISOString();
  const toISO = to.toISOString();

  const [leadsRes, trialsRes, attendedRes, convertedRes, realPayersRes] = await Promise.all([
    sb.from("leads")
      .select("id", { count: "exact", head: true })
      .gte("created_at", fromISO)
      .lte("created_at", toISO),
    sb.from("leads")
      .select("id", { count: "exact", head: true })
      .gte("created_at", fromISO)
      .lte("created_at", toISO)
      .not("trial_scheduled_at", "is", null),
    sb.from("leads")
      .select("id", { count: "exact", head: true })
      .gte("created_at", fromISO)
      .lte("created_at", toISO)
      .not("trial_attended_at", "is", null),
    sb.from("leads")
      .select("id", { count: "exact", head: true })
      .gte("created_at", fromISO)
      .lte("created_at", toISO)
      .or(`status.eq.converted,converted_at.not.is.null`),
    sb.from("payments")
      .select("student_id")
      .not("status", "eq", "refunded")
      .gte("paid_at", fromISO)
      .lte("paid_at", toISO),
  ]);

  const leadsTotal = leadsRes.count ?? 0;
  const trialsScheduled = trialsRes.count ?? 0;
  const trialsAttended = attendedRes.count ?? 0;
  const conversions = convertedRes.count ?? 0;
  const conversionsReal = new Set(
    (realPayersRes.data ?? []).map((r: { student_id: string }) => r.student_id),
  ).size;

  return {
    leads_total: leadsTotal,
    ads_conversions: 0,
    trials_scheduled: trialsScheduled,
    trials_attended: trialsAttended,
    conversions,
    conversions_real: conversionsReal,
    rate_lead_to_trial: leadsTotal > 0 ? (trialsScheduled / leadsTotal) * 100 : 0,
    rate_trial_attendance: trialsScheduled > 0 ? (trialsAttended / trialsScheduled) * 100 : 0,
    rate_attended_to_sale: trialsAttended > 0 ? (conversionsReal / trialsAttended) * 100 : 0,
    rate_lead_to_sale: leadsTotal > 0 ? (conversionsReal / leadsTotal) * 100 : 0,
    rate_real: leadsTotal > 0 ? (conversionsReal / leadsTotal) * 100 : 0,
  };
}

async function getDailyLeads(
  sb: SB, from: Date, to: Date,
): Promise<Record<string, number>> {
  const { data } = await sb
    .from("leads")
    .select("created_at")
    .gte("created_at", from.toISOString())
    .lte("created_at", to.toISOString());

  const byDay: Record<string, number> = {};
  for (const r of (data ?? []) as Array<{ created_at: string }>) {
    const day = r.created_at.slice(0, 10);
    byDay[day] = (byDay[day] ?? 0) + 1;
  }
  return byDay;
}

async function getDailyPayments(
  sb: SB, from: Date, to: Date,
): Promise<Record<string, number>> {
  const { data } = await sb
    .from("payments")
    .select("paid_at, amount_cents")
    .not("status", "eq", "refunded")
    .gte("paid_at", from.toISOString())
    .lte("paid_at", to.toISOString());

  const byDay: Record<string, number> = {};
  for (const r of (data ?? []) as Array<{ paid_at: string; amount_cents: number }>) {
    if (!r.paid_at) continue;
    const day = r.paid_at.slice(0, 10);
    byDay[day] = (byDay[day] ?? 0) + Number(r.amount_cents);
  }
  return byDay;
}

async function getRecentPayments(sb: SB, limit: number): Promise<RecentPayment[]> {
  const { data } = await sb
    .from("payments")
    .select(`
      id, amount_cents, currency, type, paid_at,
      student:students!inner(users!inner(full_name, email))
    `)
    .not("status", "eq", "refunded")
    .not("paid_at", "is", null)
    .order("paid_at", { ascending: false })
    .limit(limit);

  return (data ?? []).map(r => {
    const s = (r as { student: unknown }).student;
    const sFlat = Array.isArray(s) ? s[0] : s;
    const u = (sFlat as { users: unknown } | null)?.users;
    const uu = (Array.isArray(u) ? u[0] : u) as { full_name: string | null; email: string } | undefined;
    return {
      id: (r as { id: string }).id,
      student_name: uu?.full_name ?? null,
      student_email: uu?.email ?? "",
      amount_cents: (r as { amount_cents: number }).amount_cents,
      currency: (r as { currency: string }).currency,
      type: (r as { type: string }).type,
      paid_at: (r as { paid_at: string }).paid_at,
    };
  });
}

async function countActiveStudents(sb: SB): Promise<number> {
  const { count } = await sb
    .from("students")
    .select("id", { count: "exact", head: true })
    .eq("subscription_status", "active");
  return count ?? 0;
}

async function getAverageLTV(sb: SB): Promise<number> {
  const { data } = await sb
    .from("payments")
    .select("student_id, amount_cents")
    .not("status", "eq", "refunded");

  if (!data || data.length === 0) return 0;

  const byStudent: Record<string, number> = {};
  for (const r of data as Array<{ student_id: string; amount_cents: number }>) {
    byStudent[r.student_id] = (byStudent[r.student_id] ?? 0) + Number(r.amount_cents);
  }
  const students = Object.keys(byStudent);
  if (students.length === 0) return 0;
  return Math.round(
    students.reduce((s, sid) => s + byStudent[sid], 0) / students.length,
  );
}

/**
 * Count new clients (first payment ever falls within range) and their revenue.
 * CAC = ads / new_clients. LTV = new_client_revenue / new_clients.
 */
async function getNewClientsMetrics(sb: SB, from: Date, to: Date): Promise<{
  new_clients: number;
  new_client_revenue_cents: number;
  total_unique_clients: number;
}> {
  const { data } = await sb
    .from("payments")
    .select("student_id, amount_cents, paid_at")
    .not("status", "eq", "refunded")
    .order("paid_at", { ascending: true });

  if (!data || data.length === 0) return { new_clients: 0, new_client_revenue_cents: 0, total_unique_clients: 0 };

  const fromISO = from.toISOString();
  const toISO = to.toISOString();

  // Find first payment per student
  const firstPayment: Record<string, string> = {};
  for (const r of data as Array<{ student_id: string; paid_at: string }>) {
    if (!r.student_id || !r.paid_at) continue;
    if (!firstPayment[r.student_id]) {
      firstPayment[r.student_id] = r.paid_at;
    }
  }

  // New clients = first payment within [from, to]
  const newClientIds = new Set<string>();
  for (const [sid, firstDate] of Object.entries(firstPayment)) {
    if (firstDate >= fromISO && firstDate <= toISO) {
      newClientIds.add(sid);
    }
  }

  // Revenue from new clients in the period
  let newClientRevenue = 0;
  const clientsInPeriod = new Set<string>();
  for (const r of data as Array<{ student_id: string; amount_cents: number; paid_at: string }>) {
    if (!r.paid_at || r.paid_at < fromISO || r.paid_at > toISO) continue;
    if (!r.student_id) continue;
    clientsInPeriod.add(r.student_id);
    if (newClientIds.has(r.student_id)) {
      newClientRevenue += Number(r.amount_cents);
    }
  }

  return {
    new_clients: newClientIds.size,
    new_client_revenue_cents: newClientRevenue,
    total_unique_clients: clientsInPeriod.size,
  };
}

async function getAdsSpendFromExpenses(sb: SB, from: Date, to: Date): Promise<number> {
  const { data } = await sb
    .from("business_expenses")
    .select("amount_cents")
    .eq("category", "ads")
    .gte("incurred_at", from.toISOString().slice(0, 10))
    .lt("incurred_at", to.toISOString().slice(0, 10));

  return (data ?? []).reduce(
    (s, r) => s + Number((r as { amount_cents: number }).amount_cents), 0,
  );
}

// =============================================================================
// Detailed breakdowns for /empresa sections
// =============================================================================

export type StudentRevenue = {
  student_name: string;
  type: string;
  amount_cents: number;
  paid_at: string;
};

export type TeacherPayrollRow = {
  teacher_name: string;
  total_cents: number;
  classes_count: number;
  group_classes: number;
  individual_classes: number;
  paid: boolean;
};

export async function getRevenueByStudent(from: Date, to: Date): Promise<StudentRevenue[]> {
  const sb = supabaseAdmin();
  const { data } = await sb
    .from("payments")
    .select("amount_cents, type, paid_at, student:students!inner(users!inner(full_name))")
    .not("status", "eq", "refunded")
    .gte("paid_at", from.toISOString())
    .lte("paid_at", to.toISOString())
    .order("paid_at", { ascending: false });

  return (data ?? []).map((r: any) => {
    const s = Array.isArray(r.student) ? r.student[0] : r.student;
    const u = s?.users;
    const name = (Array.isArray(u) ? u[0] : u)?.full_name ?? "—";
    return {
      student_name: name,
      type: r.type,
      amount_cents: Number(r.amount_cents),
      paid_at: r.paid_at,
    };
  });
}

export async function getTeacherPayrollBreakdown(from: Date, to: Date): Promise<TeacherPayrollRow[]> {
  const sb = supabaseAdmin();
  const fromDate = from.toISOString().slice(0, 10);
  const toDate = to.toISOString().slice(0, 10);

  const [earningsRes, classTypesRes] = await Promise.all([
    sb.from("teacher_earnings")
      .select("teacher_id, amount_cents, classes_count, paid, teacher:teachers!inner(users!inner(full_name))")
      .gte("month", fromDate)
      .lte("month", toDate),
    sb.from("classes")
      .select("teacher_id, type, teacher:teachers!inner(user_id)")
      .eq("status", "completed")
      .gte("scheduled_at", from.toISOString())
      .lte("scheduled_at", to.toISOString()),
  ]);

  if (!earningsRes.data || earningsRes.data.length === 0) return [];

  // Class type breakdown by teacher_id
  const typesById = new Map<string, { group: number; individual: number }>();
  for (const r of (classTypesRes.data ?? []) as any[]) {
    const tid = r.teacher_id;
    if (!tid) continue;
    const existing = typesById.get(tid) ?? { group: 0, individual: 0 };
    if (r.type === "group") existing.group++;
    else existing.individual++;
    typesById.set(tid, existing);
  }

  // Aggregate earnings by teacher
  const byTeacher = new Map<string, { name: string; total: number; classes: number; paid: boolean }>();
  for (const r of earningsRes.data as any[]) {
    const t = Array.isArray(r.teacher) ? r.teacher[0] : r.teacher;
    const name = (Array.isArray(t?.users) ? t.users[0] : t?.users)?.full_name ?? "—";
    const tid = r.teacher_id ?? (t?.id ?? "");
    const existing = byTeacher.get(tid) ?? { name, total: 0, classes: 0, paid: true };
    existing.total += Number(r.amount_cents);
    existing.classes += Number(r.classes_count ?? 0);
    if (!r.paid) existing.paid = false;
    byTeacher.set(tid, existing);
  }

  return [...byTeacher.entries()]
    .map(([tid, info]) => {
      const types = typesById.get(tid) ?? { group: 0, individual: 0 };
      return {
        teacher_name: info.name,
        total_cents: info.total,
        classes_count: info.classes,
        group_classes: types.group,
        individual_classes: types.individual,
        paid: info.paid,
      };
    })
    .sort((a, b) => b.total_cents - a.total_cents);
}

// =============================================================================
// Daily merge
// =============================================================================

function mergeDailyData(
  leads: Record<string, number>,
  payments: Record<string, number>,
  from: Date,
  to: Date,
): DailyDataPoint[] {
  const result: DailyDataPoint[] = [];
  const cursor = new Date(from);
  while (cursor <= to) {
    const day = cursor.toISOString().slice(0, 10);
    result.push({
      date: day,
      leads: leads[day] ?? 0,
      revenue_cents: payments[day] ?? 0,
      expenses_cents: 0,
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
}

// =============================================================================
// Alerts
// =============================================================================

function computeAlerts(
  margenNetoPct: number,
  cacCents: number,
  ltvCents: number,
  roas: number,
  funnel: FunnelMetrics,
): EmpresaAlert[] {
  const alerts: EmpresaAlert[] = [];

  if (margenNetoPct < 30 && margenNetoPct !== 0) {
    alerts.push({
      severity: "red",
      title: "Margen neto bajo",
      detail: `El margen neto es ${margenNetoPct.toFixed(1)}%, por debajo del 30% objetivo.`,
      recommendation: "Revisa los costes variables y fijos. Considera reducir gasto en ads o renegociar tarifas.",
    });
  }

  if (cacCents > 0 && ltvCents > 0 && cacCents > ltvCents) {
    alerts.push({
      severity: "red",
      title: "CAC supera LTV",
      detail: `Cuesta ${moneyFromCents(cacCents)} adquirir un cliente que genera ${moneyFromCents(ltvCents)} en promedio.`,
      recommendation: "Reduce gasto en adquisicion o aumenta el valor de los packs vendidos.",
    });
  }

  const canScale = cacCents > 0 && ltvCents > 0
    && cacCents < ltvCents * 0.25
    && roas > 4
    && margenNetoPct > 50;
  if (canScale) {
    alerts.push({
      severity: "green",
      title: "Puedes escalar inversion",
      detail: `LTV/CAC = ${(ltvCents / cacCents).toFixed(1)}x, ROAS = ${roas.toFixed(1)}x, margen neto = ${margenNetoPct.toFixed(1)}%.`,
      recommendation: "Hay margen para aumentar el presupuesto de Google Ads entre 20-50% y seguir siendo rentable.",
    });
  }

  if (funnel.rate_lead_to_sale > 0 && funnel.rate_trial_attendance < 50 && funnel.trials_scheduled >= 5) {
    alerts.push({
      severity: "amber",
      title: "Baja asistencia a pruebas",
      detail: `Solo ${funnel.rate_trial_attendance.toFixed(0)}% de las pruebas agendadas se atienden.`,
      recommendation: "Refuerza los recordatorios por WhatsApp y email 2h antes de la clase.",
    });
  }

  return alerts;
}

// =============================================================================
// Costes fijos CRUD
// =============================================================================

export async function listCostesFijos(): Promise<CosteFijo[]> {
  const sb = supabaseAdmin();
  const { data } = await sb
    .from("costes_fijos")
    .select("*")
    .order("active", { ascending: false })
    .order("category")
    .order("name");
  return (data ?? []) as CosteFijo[];
}

export async function createCosteFijo(input: {
  name: string;
  category: string;
  amount_cents: number;
  notes?: string;
  starts_at?: string;
  ends_at?: string | null;
}): Promise<CosteFijo> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("costes_fijos")
    .insert({
      name: input.name,
      category: input.category,
      amount_cents: input.amount_cents,
      notes: input.notes ?? null,
      starts_at: input.starts_at ?? new Date().toISOString().slice(0, 10),
      ends_at: input.ends_at ?? null,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as CosteFijo;
}

export async function updateCosteFijo(
  id: string,
  input: Partial<{
    name: string;
    category: string;
    amount_cents: number;
    active: boolean;
    notes: string | null;
    starts_at: string;
    ends_at: string | null;
  }>,
): Promise<CosteFijo> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("costes_fijos")
    .update(input)
    .eq("id", id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as CosteFijo;
}

export async function deleteCosteFijo(id: string): Promise<void> {
  const sb = supabaseAdmin();
  const { error } = await sb
    .from("costes_fijos")
    .delete()
    .eq("id", id);
  if (error) throw new Error(error.message);
}

// =============================================================================
// Google Ads freshness check
// =============================================================================

export async function getGoogleAdsLastSync(): Promise<string | null> {
  const sb = supabaseAdmin();
  const { data } = await sb
    .from("google_ads_daily")
    .select("date")
    .order("date", { ascending: false })
    .limit(1);
  return (data as Array<{ date: string }> | null)?.[0]?.date ?? null;
}

// =============================================================================
// Google Ads spend (from google_ads_daily table)
// =============================================================================

async function getGoogleAdsSpend(sb: SB, from: Date, to: Date): Promise<number> {
  const fromDate = from.toISOString().slice(0, 10);
  const toDate = to.toISOString().slice(0, 10);

  const { data } = await sb
    .from("google_ads_daily")
    .select("cost_micros")
    .gte("date", fromDate)
    .lte("date", toDate);

  if (!data || data.length === 0) return 0;

  const totalMicros = (data as Array<{ cost_micros: number }>).reduce(
    (s, r) => s + Number(r.cost_micros), 0,
  );
  // Convert micros (1/1,000,000) to cents (1/100)
  return Math.round(totalMicros / 10000);
}

async function getGoogleAdsConversions(sb: SB, from: Date, to: Date): Promise<number> {
  const fromDate = from.toISOString().slice(0, 10);
  const toDate = to.toISOString().slice(0, 10);

  const { data } = await sb
    .from("google_ads_daily")
    .select("conversions")
    .gte("date", fromDate)
    .lte("date", toDate);

  if (!data || data.length === 0) return 0;

  return Math.round(
    (data as Array<{ conversions: number }>).reduce((s, r) => s + Number(r.conversions), 0),
  );
}

// =============================================================================
// Monthly report
// =============================================================================

export type MonthlyPayment = {
  student_name: string;
  amount_cents: number;
  type: string;
  paid_at: string;
};

export type MonthlyRow = {
  label: string;
  from: string;
  to: string;
  revenue_cents: number;
  revenue_by_type: Record<string, number>;
  payroll_cents: number;
  fixed_cents: number;
  ads_cents: number;
  neto_cents: number;
  margen_neto_pct: number;
  roas: number;
  leads: number;
  conversions: number;
  payments_count: number;
  students_count: number;
  payments: MonthlyPayment[];
};

export async function getMonthlyReport(monthsBack = 8): Promise<MonthlyRow[]> {
  const sb = supabaseAdmin();
  const now = new Date();
  const berlin = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Berlin" }));
  const rows: MonthlyRow[] = [];

  for (let i = monthsBack - 1; i >= 0; i--) {
    const year = berlin.getFullYear();
    const month = berlin.getMonth() - i;
    const from = new Date(Date.UTC(year, month, 1));
    const lastDay = new Date(Date.UTC(year, month + 1, 0));
    const to = i === 0
      ? new Date(Date.UTC(berlin.getFullYear(), berlin.getMonth(), berlin.getDate(), 23, 59, 59))
      : new Date(Date.UTC(lastDay.getFullYear(), lastDay.getMonth(), lastDay.getDate(), 23, 59, 59));

    const fromISO = from.toISOString();
    const toISO = to.toISOString();
    const fromDate = fromISO.slice(0, 10);
    const toDate = toISO.slice(0, 10);

    const monthNames = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
    const label = `${monthNames[from.getUTCMonth()]} ${from.getUTCFullYear().toString().slice(2)}`;

    const [revenue, payroll, fixed, ads, leadsRes, convRes] = await Promise.all([
      sb.from("payments")
        .select("amount_cents, student_id, type, paid_at, student:students!inner(users!inner(full_name))")
        .not("status", "eq", "refunded")
        .gte("paid_at", fromISO)
        .lte("paid_at", toISO)
        .order("paid_at", { ascending: false }),
      sb.from("teacher_earnings")
        .select("amount_cents")
        .gte("month", fromDate)
        .lte("month", toDate),
      sb.from("costes_fijos")
        .select("amount_cents")
        .eq("active", true)
        .lte("starts_at", toDate)
        .or(`ends_at.is.null,ends_at.gte.${fromDate}`),
      sb.from("google_ads_daily")
        .select("cost_micros")
        .gte("date", fromDate)
        .lte("date", toDate),
      sb.from("leads")
        .select("id", { count: "exact", head: true })
        .gte("created_at", fromISO)
        .lte("created_at", toISO),
      sb.from("leads")
        .select("id", { count: "exact", head: true })
        .eq("status", "converted")
        .gte("converted_at", fromISO)
        .lte("converted_at", toISO),
    ]);

    const revenueRows = (revenue.data ?? []) as any[];
    const revenueCents = revenueRows.reduce((s, r) => s + Number(r.amount_cents), 0);
    const paymentsCount = revenueRows.length;
    const studentsCount = new Set(revenueRows.map(r => r.student_id)).size;
    const revenueByType: Record<string, number> = {};
    const paymentsList: MonthlyPayment[] = [];
    for (const r of revenueRows) {
      revenueByType[r.type] = (revenueByType[r.type] ?? 0) + Number(r.amount_cents);
      const s = Array.isArray(r.student) ? r.student[0] : r.student;
      const u = s?.users;
      const name = (Array.isArray(u) ? u[0] : u)?.full_name ?? "—";
      paymentsList.push({ student_name: name, amount_cents: Number(r.amount_cents), type: r.type, paid_at: r.paid_at });
    }
    const payrollCents = (payroll.data ?? []).reduce((s, r: any) => s + Number(r.amount_cents), 0);
    const fixedCents = (fixed.data ?? []).reduce((s, r: any) => s + Number(r.amount_cents), 0);
    const adsMicros = (ads.data ?? []).reduce((s, r: any) => s + Number(r.cost_micros), 0);
    const adsCents = Math.round(adsMicros / 10000);

    const netoCents = revenueCents - payrollCents - fixedCents - adsCents;
    const margenPct = revenueCents > 0 ? (netoCents / revenueCents) * 100 : 0;
    const roas = adsCents > 0 ? revenueCents / adsCents : 0;

    rows.push({
      label,
      from: fromDate,
      to: toDate,
      revenue_cents: revenueCents,
      revenue_by_type: revenueByType,
      payroll_cents: payrollCents,
      fixed_cents: fixedCents,
      ads_cents: adsCents,
      neto_cents: netoCents,
      margen_neto_pct: margenPct,
      roas,
      leads: leadsRes.count ?? 0,
      conversions: convRes.count ?? 0,
      payments_count: paymentsCount,
      students_count: studentsCount,
      payments: paymentsList,
    });
  }

  return rows;
}

// =============================================================================
// Pulse — key operational metrics shown at the top of /empresa
// =============================================================================

export type AtRiskStudent = {
  name: string;
  last_paid: string;
  monthly_value_cents: number;
};

export type PulseData = {
  conversion_rate_pct: number;
  leads_this_month: number;
  conversions_this_month: number;
  retention_pct: number;
  students_prev_month: number;
  students_retained: number;
  at_risk: AtRiskStudent[];
  roas_current: number;
  roas_prev: number;
  ads_spend_cents: number;
  revenue_projected_cents: number;
  cpl_cents: number;
};

export async function getPulseData(
  from: Date,
  to: Date,
  prevFrom: Date,
  prevTo: Date,
): Promise<PulseData> {
  const sb = supabaseAdmin();
  const periodDays = Math.max(1, Math.ceil((to.getTime() - from.getTime()) / 86_400_000));

  const currFromISO = from.toISOString();
  const currToISO = to.toISOString();
  const prevFromISO = prevFrom.toISOString();
  const prevToISO = prevTo.toISOString();

  const [leadsRes, convRes, currPayments, prevPayments, adsRes, prevAdsRes] = await Promise.all([
    sb.from("leads").select("id", { count: "exact", head: true })
      .gte("created_at", currFromISO).lte("created_at", currToISO),
    sb.from("leads").select("id", { count: "exact", head: true })
      .eq("status", "converted")
      .gte("converted_at", currFromISO).lte("converted_at", currToISO),
    sb.from("payments")
      .select("student_id, amount_cents, paid_at, student:students!inner(users!inner(full_name))")
      .not("status", "eq", "refunded")
      .gte("paid_at", currFromISO).lte("paid_at", currToISO),
    sb.from("payments")
      .select("student_id, amount_cents, paid_at, student:students!inner(users!inner(full_name))")
      .not("status", "eq", "refunded")
      .gte("paid_at", prevFromISO).lte("paid_at", prevToISO),
    sb.from("google_ads_daily").select("cost_micros")
      .gte("date", currFromISO.slice(0, 10)).lte("date", currToISO.slice(0, 10)),
    sb.from("google_ads_daily").select("cost_micros")
      .gte("date", prevFromISO.slice(0, 10)).lte("date", prevToISO.slice(0, 10)),
  ]);

  const leads = leadsRes.count ?? 0;
  const conversions = convRes.count ?? 0;
  const convRate = leads > 0 ? (conversions / leads) * 100 : 0;

  const currRows = (currPayments.data ?? []) as any[];
  const prevRows = (prevPayments.data ?? []) as any[];
  const currStudentIds = new Set(currRows.map(r => r.student_id));
  const prevStudentIds = new Set(prevRows.map(r => r.student_id));
  const retained = [...prevStudentIds].filter(id => currStudentIds.has(id));
  const retentionPct = prevStudentIds.size > 0 ? (retained.length / prevStudentIds.size) * 100 : 100;

  // At-risk: paid last month but not this month
  const atRisk: AtRiskStudent[] = [];
  const prevByStudent = new Map<string, { name: string; total: number; lastPaid: string }>();
  for (const r of prevRows) {
    const sid = r.student_id;
    const s = Array.isArray(r.student) ? r.student[0] : r.student;
    const u = s?.users;
    const name = (Array.isArray(u) ? u[0] : u)?.full_name ?? "—";
    const existing = prevByStudent.get(sid);
    if (existing) {
      existing.total += Number(r.amount_cents);
    } else {
      prevByStudent.set(sid, { name, total: Number(r.amount_cents), lastPaid: r.paid_at });
    }
  }
  for (const [sid, info] of prevByStudent) {
    if (!currStudentIds.has(sid)) {
      atRisk.push({ name: info.name, last_paid: info.lastPaid, monthly_value_cents: info.total });
    }
  }
  atRisk.sort((a, b) => b.monthly_value_cents - a.monthly_value_cents);

  // Ads
  const adsCents = Math.round(
    (adsRes.data ?? []).reduce((s, r: any) => s + Number(r.cost_micros), 0) / 10000
  );
  const prevAdsCents = Math.round(
    (prevAdsRes.data ?? []).reduce((s, r: any) => s + Number(r.cost_micros), 0) / 10000
  );
  const currRevenue = currRows.reduce((s, r) => s + Number(r.amount_cents), 0);
  const prevRevenue = prevRows.reduce((s, r) => s + Number(r.amount_cents), 0);
  const roasCurr = adsCents > 0 ? currRevenue / adsCents : 0;
  const roasPrev = prevAdsCents > 0 ? prevRevenue / prevAdsCents : 0;

  const projectedRevenue = periodDays > 0 ? Math.round(currRevenue / periodDays * 30) : 0;
  const cplCents = leads > 0 ? Math.round(adsCents / leads) : 0;

  return {
    conversion_rate_pct: convRate,
    leads_this_month: leads,
    conversions_this_month: conversions,
    retention_pct: retentionPct,
    students_prev_month: prevStudentIds.size,
    students_retained: retained.length,
    at_risk: atRisk,
    roas_current: roasCurr,
    roas_prev: roasPrev,
    ads_spend_cents: adsCents,
    revenue_projected_cents: projectedRevenue,
    cpl_cents: cplCents,
  };
}

// =============================================================================
// LTV with projected payments from Stripe subscriptions
// =============================================================================

export type LtvClientRow = {
  name: string;
  email: string;
  type: "subscription" | "package";
  paid_cents: number;
  pending_cents: number;
  ltv_projected_cents: number;
};

export type LtvSummary = {
  ltv_real_cents: number;
  ltv_projected_cents: number;
  ltv_cac_real: number;
  ltv_cac_projected: number;
  clients: LtvClientRow[];
};

export async function getLtvWithProjections(cacCents: number): Promise<LtvSummary> {
  const sb = supabaseAdmin();
  let stripe: ReturnType<typeof stripeDE> | null = null;
  try { stripe = stripeDE(); } catch { /* env var missing */ }

  // 1. Get all paid amounts from DB grouped by student
  const { data: payments } = await sb
    .from("payments")
    .select("student_id, amount_cents, student:students(users(full_name, email))")
    .not("status", "eq", "refunded");

  const byStudent = new Map<string, { name: string; email: string; paid: number }>();
  for (const r of (payments ?? []) as any[]) {
    const s = Array.isArray(r.student) ? r.student[0] : r.student;
    const u = s?.users;
    const uu = Array.isArray(u) ? u[0] : u;
    const name = uu?.full_name ?? "—";
    const email = uu?.email ?? "";
    const existing = byStudent.get(r.student_id);
    if (existing) {
      existing.paid += Number(r.amount_cents);
    } else {
      byStudent.set(r.student_id, { name, email, paid: Number(r.amount_cents) });
    }
  }

  // 2. Get active subscriptions from Stripe DE
  const pendingByEmail = new Map<string, number>();
  try {
    if (!stripe) throw new Error("no stripe client");
    const subscriptions = await stripe.subscriptions.list({
      status: "active",
      limit: 100,
      expand: ["data.customer"],
    });

    for (const sub of subscriptions.data) {
      const customer = sub.customer as { email?: string } | string;
      const email = typeof customer === "string" ? "" : (customer.email ?? "");
      if (!email) continue;

      let pendingCents = 0;
      for (const item of sub.items.data) {
        const unitAmount = item.price.unit_amount ?? 0;
        const qty = item.quantity ?? 1;
        const monthlyAmount = unitAmount * qty;

        if (sub.cancel_at) {
          // Has a scheduled cancellation — calculate remaining payments
          const nowSec = Math.floor(Date.now() / 1000);
          const remainingSec = Math.max(0, sub.cancel_at - nowSec);
          const remainingMonths = Math.ceil(remainingSec / (30 * 86400));
          pendingCents += monthlyAmount * remainingMonths;
        } else {
          // No cancellation scheduled — project 6 months of payments
          pendingCents += monthlyAmount * 6;
        }
      }

      const current = pendingByEmail.get(email.toLowerCase()) ?? 0;
      pendingByEmail.set(email.toLowerCase(), current + pendingCents);
    }
  } catch {
    // Stripe API error — continue with 0 projections
  }

  // 3. Build client rows
  const clients: LtvClientRow[] = [];
  let totalPaid = 0;
  let totalPending = 0;

  for (const [, info] of byStudent) {
    const pending = pendingByEmail.get(info.email.toLowerCase()) ?? 0;
    const hasSubscription = pending > 0;
    clients.push({
      name: info.name,
      email: info.email,
      type: hasSubscription ? "subscription" : "package",
      paid_cents: info.paid,
      pending_cents: pending,
      ltv_projected_cents: info.paid + pending,
    });
    totalPaid += info.paid;
    totalPending += pending;
  }

  clients.sort((a, b) => b.ltv_projected_cents - a.ltv_projected_cents);

  const studentCount = Math.max(clients.length, 1);
  const ltvReal = Math.round(totalPaid / studentCount);
  const ltvProjected = Math.round((totalPaid + totalPending) / studentCount);

  return {
    ltv_real_cents: ltvReal,
    ltv_projected_cents: ltvProjected,
    ltv_cac_real: cacCents > 0 ? ltvReal / cacCents : 0,
    ltv_cac_projected: cacCents > 0 ? ltvProjected / cacCents : 0,
    clients,
  };
}

// Re-export for convenience
export { moneyFromCents } from "./finance";
