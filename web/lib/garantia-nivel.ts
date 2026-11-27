import { supabaseAdmin } from "./supabase";
import {
  evaluateGarantia, legacyGarantiaStatus, levelProgressFraction,
  type GarantiaEvaluation, type GarantiaStatus,
} from "./garantia-rules";

/**
 * Motor de la Garantía de Nivel: datos + persistencia. Las reglas (puras)
 * están en lib/garantia-rules.ts.
 *
 * Desde 2026-11-27 el % de ejercicios se LEE de SCHULE (endpoint interno
 * /api/internal/student/progress, que ya existía allí) y el estado se
 * calcula con asistencia + ejercicios, con los umbrales del contrato.
 *
 * Despliegue por fases (decisión de Gelfis): la tarjeta nueva la ven ya
 * profes y admins; el ALUMNO sigue viendo la tarjeta de siempre hasta que
 * se ponga system_config.garantia_v2_alumnos = "on".
 */

export type { GarantiaStatus };

export type GarantiaData = {
  attendanceRate: number | null;
  schuleCompletionPct: number | null;
  status: GarantiaStatus;
};

/** Compatibilidad: reglas antiguas (las usa aún la vista del alumno). */
export function computeGarantiaStatus(attendanceRate: number | null, schuleCompletion: number | null): GarantiaStatus {
  return legacyGarantiaStatus(attendanceRate, schuleCompletion);
}

const SCHULE_API = (process.env.SCHULE_API_URL ?? "https://api-schule.aprender-aleman.de").replace(/\/$/, "");

/** Clases regulares celebradas (dadas o ausencia) y a cuántas asistió. */
export async function computeStudentAttendance(studentId: string): Promise<{ held: number; attended: number }> {
  const sb = supabaseAdmin();
  const { data: parts } = await sb
    .from("class_participants")
    .select("attended, class:classes!inner(status, is_trial)")
    .eq("student_id", studentId)
    .in("class.status", ["completed", "absent"]);
  const regular = (parts ?? []).filter(p => {
    const cls = Array.isArray(p.class) ? p.class[0] : p.class;
    return !(cls as { is_trial?: boolean })?.is_trial;
  });
  return { held: regular.length, attended: regular.filter(p => p.attended === true).length };
}

/** Compatibilidad: % de asistencia o null si hay menos de 3 clases. */
export async function computeStudentAttendanceRate(studentId: string): Promise<number | null> {
  const { held, attended } = await computeStudentAttendance(studentId);
  if (held < 3) return null;
  return Math.round((attended / held) * 100 * 100) / 100;
}

export type SchuleProgress =
  | { ok: true; found: boolean; pct: number; level: string | null; lastActivity: string | null }
  | { ok: false; error: string };

/**
 * % de ejercicios del nivel actual que el alumno tiene hechos en SCHULE
 * (cuentan los completados con nota ≥ 70 %). Si el alumno nunca ha entrado
 * a SCHULE (found=false) el % es 0. Si la llamada falla NO se inventa un
 * valor: quien llama conserva el último dato guardado.
 */
export async function fetchSchuleProgress(userEmail: string): Promise<SchuleProgress> {
  const secret = process.env.B2C_SYNC_SECRET;
  if (!secret) return { ok: false, error: "B2C_SYNC_SECRET no configurado" };
  if (!userEmail) return { ok: false, error: "sin email" };
  try {
    const res = await fetch(`${SCHULE_API}/api/internal/student/progress?email=${encodeURIComponent(userEmail)}`, {
      headers: { "x-internal-api-key": secret },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return { ok: false, error: `SCHULE respondió ${res.status}` };
    const j = (await res.json()) as { found?: boolean; level?: string; lastActivityDate?: string | null; path?: { pct?: number } };
    if (!j.found) return { ok: true, found: false, pct: 0, level: null, lastActivity: null };
    const pct = Number(j.path?.pct);
    if (!Number.isFinite(pct)) return { ok: false, error: "respuesta de SCHULE sin porcentaje" };
    return { ok: true, found: true, pct: Math.max(0, Math.min(100, pct)), level: j.level ?? null, lastActivity: j.lastActivityDate ?? null };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "error de red" };
  }
}

/** Compatibilidad con el nombre antiguo (antes era un stub que devolvía null). */
export async function fetchSchuleCompletion(_studentId: string, userEmail: string): Promise<number | null> {
  const r = await fetchSchuleProgress(userEmail);
  return r.ok ? r.pct : null;
}

type StudentRow = {
  user_id: string; goal: string | null; current_level: string | null; clases_totales: number | null;
  schule_completion_pct: number | null; users: unknown;
};

async function loadStudentRow(studentId: string): Promise<(StudentRow & { email: string }) | null> {
  const { data } = await supabaseAdmin().from("students")
    .select("user_id, goal, current_level, clases_totales, schule_completion_pct, users!inner(email)")
    .eq("id", studentId).maybeSingle();
  if (!data) return null;
  const s = data as unknown as StudentRow;
  const u = (Array.isArray(s.users) ? s.users[0] : s.users) as { email: string } | undefined;
  return { ...s, email: u?.email ?? "" };
}

/** Evaluación completa con los datos actuales (asistencia en vivo + % de SCHULE dado). */
async function evaluateStudent(studentId: string, s: StudentRow, schulePct: number | null): Promise<GarantiaEvaluation> {
  const { held, attended } = await computeStudentAttendance(studentId);
  return evaluateGarantia({
    held, attended,
    totalClasses: s.clases_totales,
    schulePct,
    levelFraction: levelProgressFraction({ goal: s.goal, currentLevel: s.current_level, consumed: held, totalClasses: s.clases_totales }),
  });
}

/** Recalcula y guarda (cron diario). Lee SCHULE; si falla, conserva el último % guardado. */
export async function recomputeGarantia(studentId: string): Promise<GarantiaData & { schuleError?: string }> {
  const sb = supabaseAdmin();
  const s = await loadStudentRow(studentId);
  if (!s) return { attendanceRate: null, schuleCompletionPct: null, status: "not_applicable" };

  const schule = await fetchSchuleProgress(s.email);
  const schulePct = schule.ok ? schule.pct : (s.schule_completion_pct === null ? null : Number(s.schule_completion_pct));
  const ev = await evaluateStudent(studentId, s, schulePct);

  await sb.from("students").update({
    attendance_rate: ev.attendanceRate,
    schule_completion_pct: schulePct,
    garantia_status: ev.status,
  }).eq("id", studentId);

  return { attendanceRate: ev.attendanceRate, schuleCompletionPct: schulePct, status: ev.status, ...(schule.ok ? {} : { schuleError: schule.error }) };
}

export async function recomputeAllGarantias(): Promise<number> {
  const sb = supabaseAdmin();
  const { data: students } = await sb.from("students").select("id").in("subscription_status", ["active", "paused"]);
  let updated = 0;
  for (const s of students ?? []) {
    await recomputeGarantia(s.id as string);
    updated++;
  }
  return updated;
}

/**
 * Vista de la garantía para la ficha (profe/admin): evaluación en vivo con
 * el último % de SCHULE guardado por el cron (no llama a SCHULE al pintar).
 */
export async function getGarantiaView(studentId: string): Promise<GarantiaEvaluation | null> {
  const s = await loadStudentRow(studentId);
  if (!s) return null;
  return evaluateStudent(studentId, s, s.schule_completion_pct === null ? null : Number(s.schule_completion_pct));
}

/** ¿Los ALUMNOS ya ven la tarjeta nueva? (system_config.garantia_v2_alumnos = "on"). Por defecto no. */
export async function isGarantiaV2ForStudents(): Promise<boolean> {
  try {
    const { data } = await supabaseAdmin().from("system_config").select("value").eq("key", "garantia_v2_alumnos").maybeSingle();
    const v = (data as { value?: unknown } | null)?.value;
    return v === true || v === "on" || v === "true" || v === "1";
  } catch {
    return false;
  }
}
