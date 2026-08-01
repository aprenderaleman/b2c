import { supabaseAdmin } from "./supabase";

export type GarantiaStatus = "active" | "at_risk" | "lost" | "not_applicable";

export type GarantiaData = {
  attendanceRate: number | null;
  schuleCompletionPct: number | null;
  status: GarantiaStatus;
};

const ATTENDANCE_THRESHOLD = 80;
const SCHULE_THRESHOLD = 70;

export function computeGarantiaStatus(
  attendanceRate: number | null,
  schuleCompletion: number | null,
): GarantiaStatus {
  if (attendanceRate === null) return "not_applicable";

  const attendanceOk = attendanceRate >= ATTENDANCE_THRESHOLD;
  const schuleOk = schuleCompletion === null || schuleCompletion >= SCHULE_THRESHOLD;

  if (attendanceOk && schuleOk) return "active";
  if (attendanceRate < 50) return "lost";
  return "at_risk";
}

export async function computeStudentAttendanceRate(
  studentId: string,
): Promise<number | null> {
  const sb = supabaseAdmin();

  const { data: parts } = await sb
    .from("class_participants")
    .select("attended, class:classes!inner(status, is_trial)")
    .eq("student_id", studentId)
    .in("class.status", ["completed", "absent"]);

  if (!parts?.length) return null;

  // Exclude trials
  const regular = parts.filter(p => {
    const cls = Array.isArray(p.class) ? p.class[0] : p.class;
    return !(cls as { is_trial?: boolean })?.is_trial;
  });

  if (regular.length < 3) return null;

  const attended = regular.filter(p => p.attended === true).length;
  return Math.round((attended / regular.length) * 100 * 100) / 100;
}

export async function fetchSchuleCompletion(
  _studentId: string,
  _userEmail: string,
): Promise<number | null> {
  // STUB: SCHULE API integration pending.
  // When SCHULE dev provides the endpoint, this function will:
  // 1. Call GET {SCHULE_API_URL}/api/student/{email}/completion
  //    using the existing SSO credentials (SCHULE_API_KEY)
  // 2. Return the completion percentage (0-100)
  //
  // For now, return null (feature degrades gracefully — card shows
  // "pendiente de conexion" for the exercises metric).
  return null;
}

export async function recomputeGarantia(studentId: string): Promise<GarantiaData> {
  const sb = supabaseAdmin();

  const attendanceRate = await computeStudentAttendanceRate(studentId);

  const { data: student } = await sb
    .from("students")
    .select("user_id, users!inner(email)")
    .eq("id", studentId)
    .maybeSingle();

  const userEmail = (() => {
    if (!student) return "";
    const u = Array.isArray(student.users) ? student.users[0] : student.users;
    return (u as { email: string })?.email ?? "";
  })();

  const schuleCompletion = await fetchSchuleCompletion(studentId, userEmail);
  const status = computeGarantiaStatus(attendanceRate, schuleCompletion);

  await sb.from("students").update({
    attendance_rate: attendanceRate,
    schule_completion_pct: schuleCompletion,
    garantia_status: status,
  }).eq("id", studentId);

  return { attendanceRate, schuleCompletionPct: schuleCompletion, status };
}

export async function recomputeAllGarantias(): Promise<number> {
  const sb = supabaseAdmin();

  const { data: students } = await sb
    .from("students")
    .select("id")
    .eq("subscription_status", "active");

  let updated = 0;
  for (const s of students ?? []) {
    await recomputeGarantia(s.id as string);
    updated++;
  }
  return updated;
}
