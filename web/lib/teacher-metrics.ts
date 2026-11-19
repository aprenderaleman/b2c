import { supabaseAdmin } from "./supabase";

/**
 * Métricas del perfil de un profesor en /admin/profesores/[id]
 * (Gelfis 2026-11-19): embudo de clases de prueba, alumnos y churn,
 * horas invertidas y € ganados por hora.
 *
 * Definiciones (las mismas que explica la nota al pie del panel):
 *
 * - LEADS RECIBIDOS: leads distintos con una clase de prueba NO cancelada
 *   con el profe. Si un lead reagendó varias veces con él, cuenta una vez
 *   y manda su última clase.
 * - ASISTIÓ / NO ASISTIÓ: la asistencia de una prueba vive en el lead
 *   (leads.trial_attended_at / trial_absent_at), no en class_participants
 *   (las clases de prueba no tienen participantes). Se atribuye a la clase
 *   del profe si la marca cae en la ventana de esa clase.
 * - CONVERSIÓN: lead del profe que hoy es estudiante.
 * - ALUMNOS: todos los que han estado en un grupo del profe. Estado HOY:
 *   activo, en pausa, reasignado a otro profe, plan terminado o baja.
 *   CHURN = bajas / (activos + pausa + terminados + bajas); los
 *   reasignados no cuentan porque siguen en la academia.
 * - HORAS INVERTIDAS: pruebas asistidas (duración programada) + pruebas
 *   no asistidas (espera real según la grabación de la sala, o 15 min si
 *   no hay dato) + clases recurrentes (minutos de nómina).
 * - € GANADOS: pago por clases (class_hours_log) + comisiones y bonos
 *   (comisiones). Coincide con la nómina (teacher_earnings).
 */

export const NO_SHOW_WAIT_MIN = 15;

export type TrialOutcome = "attended" | "absent" | "unmarked" | "pending";

export type TrialClassLite = {
  id: string;
  lead_id: string | null;
  status: string;
  scheduled_at: string;
  duration_minutes: number | null;
};

export type LeadLite = {
  id: string;
  trial_attended_at: string | null;
  trial_absent_at: string | null;
  converted_to_user_id: string | null;
};

const H = 3_600_000;

/** ¿La marca (asistió / no asistió) del lead corresponde a ESTA clase? */
export function markBelongsToClass(markIso: string | null, classIso: string): boolean {
  if (!markIso) return false;
  const d = new Date(markIso).getTime() - new Date(classIso).getTime();
  // Se marca al terminar la clase o, como tarde, al día siguiente.
  return d >= -2 * H && d <= 36 * H;
}

export function trialOutcome(cls: TrialClassLite, lead: LeadLite | undefined, nowMs: number): TrialOutcome {
  if (new Date(cls.scheduled_at).getTime() > nowMs && cls.status === "scheduled") return "pending";
  if (lead && markBelongsToClass(lead.trial_attended_at, cls.scheduled_at)) return "attended";
  if (lead && markBelongsToClass(lead.trial_absent_at, cls.scheduled_at)) return "absent";
  if (cls.status === "absent") return "absent";
  return "unmarked";
}

/** Última clase de prueba no cancelada de cada lead con este profe. */
export function latestTrialPerLead(classes: TrialClassLite[]): Map<string, TrialClassLite> {
  const out = new Map<string, TrialClassLite>();
  for (const c of classes) {
    if (!c.lead_id || c.status === "cancelled") continue;
    const prev = out.get(c.lead_id);
    if (!prev || c.scheduled_at > prev.scheduled_at) out.set(c.lead_id, c);
  }
  return out;
}

export type StudentState = "active" | "paused" | "reassigned" | "finished" | "churned";

export function studentState(s: {
  userActive: boolean;
  subscriptionStatus: string | null;
  hasActiveGroupWithTeacher: boolean;
  hasActiveGroupWithOther: boolean;
}): StudentState {
  const st = s.subscriptionStatus ?? "";
  if (s.hasActiveGroupWithTeacher && s.userActive && st === "active") return "active";
  if (s.hasActiveGroupWithTeacher && s.userActive && st === "paused") return "paused";
  if (s.hasActiveGroupWithOther && s.userActive && (st === "active" || st === "paused")) return "reassigned";
  if (st === "expired") return "finished";
  return "churned";
}

export function pct(num: number, den: number): number | null {
  return den > 0 ? (num / den) * 100 : null;
}

export type TeacherMetrics = {
  since: string | null;
  funnel: {
    leads: number;
    attended: number;
    absent: number;
    unmarked: number;
    pending: number;
    cancelledOnly: number;
    attendanceRate: number | null;
    conversions: number;
    conversionRate: number | null;
  };
  students: {
    total: number;
    active: number;
    paused: number;
    reassigned: number;
    finished: number;
    churned: number;
    churnRate: number | null;
  };
  hours: {
    trialAttendedMin: number;
    trialAbsentMin: number;
    trialUnmarkedMin: number;
    regularMin: number;
    regularClasses: number;
    totalMin: number;
  };
  earnings: {
    classesCents: number;
    commissionsCents: number;
    totalCents: number;
    perHourCents: number | null;
    perClassHourCents: number | null;
  };
};

type Sb = ReturnType<typeof supabaseAdmin>;

/** Supabase devuelve como máximo 1000 filas por consulta: paginar. */
async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

export async function getTeacherMetrics(teacherId: string, teacherUserId: string, opts: { since?: Date | null; now?: Date } = {}): Promise<TeacherMetrics> {
  const sb: Sb = supabaseAdmin();
  const now = opts.now ?? new Date();
  const nowMs = now.getTime();
  const sinceIso = opts.since ? opts.since.toISOString() : null;

  // ── 1. Embudo de clases de prueba ────────────────────────────────────
  const trials = await fetchAll<TrialClassLite>((from, to) => {
    let q = sb.from("classes")
      .select("id, lead_id, status, scheduled_at, duration_minutes")
      .eq("teacher_id", teacherId).eq("is_trial", true).is("deleted_at", null)
      .order("scheduled_at").range(from, to);
    if (sinceIso) q = q.gte("scheduled_at", sinceIso);
    return q;
  });
  const latest = latestTrialPerLead(trials);
  const cancelledOnly = new Set(trials.filter(c => c.lead_id && !latest.has(c.lead_id)).map(c => c.lead_id as string)).size;

  const leadIds = [...latest.keys()];
  const leads = new Map<string, LeadLite>();
  for (const part of chunk(leadIds, 200)) {
    const { data, error } = await sb.from("leads").select("id, trial_attended_at, trial_absent_at, converted_to_user_id").in("id", part);
    if (error) throw new Error(error.message);
    for (const l of (data ?? []) as LeadLite[]) leads.set(l.id, l);
  }

  // Duración de la grabación de la sala: espera real en las no asistidas.
  const recSecs = new Map<string, number>();
  const trialIds = [...latest.values()].map(c => c.id);
  for (const part of chunk(trialIds, 200)) {
    const { data } = await sb.from("recordings").select("class_id, duration_seconds").in("class_id", part);
    for (const r of (data ?? []) as Array<{ class_id: string; duration_seconds: number | null }>) {
      if (r.duration_seconds != null) recSecs.set(r.class_id, Math.max(recSecs.get(r.class_id) ?? 0, r.duration_seconds));
    }
  }

  const f = { attended: 0, absent: 0, unmarked: 0, pending: 0, conversions: 0 };
  const hours = { trialAttendedMin: 0, trialAbsentMin: 0, trialUnmarkedMin: 0 };
  for (const [leadId, cls] of latest) {
    const lead = leads.get(leadId);
    const outcome = trialOutcome(cls, lead, nowMs);
    f[outcome]++;
    const planned = cls.duration_minutes ?? 45;
    if (outcome === "attended") hours.trialAttendedMin += planned;
    else if (outcome === "unmarked") hours.trialUnmarkedMin += planned;
    else if (outcome === "absent") {
      const rec = recSecs.get(cls.id);
      hours.trialAbsentMin += rec != null ? Math.min(Math.round(rec / 60), planned) : NO_SHOW_WAIT_MIN;
    }
    if (lead?.converted_to_user_id && outcome !== "pending") f.conversions++;
  }

  // ── 2. Alumnos y churn (estado de hoy; no depende del periodo) ───────
  const groups = await fetchAll<{ id: string; active: boolean; student_group_members: Array<{ student_id: string }> | null }>((from, to) =>
    sb.from("student_groups").select("id, active, student_group_members(student_id)").eq("teacher_id", teacherId).range(from, to));
  const withTeacherActive = new Set<string>();
  const everWithTeacher = new Set<string>();
  for (const g of groups) for (const m of g.student_group_members ?? []) {
    everWithTeacher.add(m.student_id);
    if (g.active) withTeacherActive.add(m.student_id);
  }
  const st = { active: 0, paused: 0, reassigned: 0, finished: 0, churned: 0 };
  const studentIds = [...everWithTeacher];
  for (const part of chunk(studentIds, 150)) {
    const [{ data: studs, error: e1 }, { data: mems, error: e2 }] = await Promise.all([
      sb.from("students").select("id, subscription_status, users!inner(active)").in("id", part),
      sb.from("student_group_members").select("student_id, student_groups!inner(active, teacher_id)").in("student_id", part).eq("student_groups.active", true),
    ]);
    if (e1) throw new Error(e1.message);
    if (e2) throw new Error(e2.message);
    const otherActive = new Set<string>();
    for (const m of (mems ?? []) as unknown as Array<{ student_id: string; student_groups: { teacher_id: string } | Array<{ teacher_id: string }> }>) {
      const sg = Array.isArray(m.student_groups) ? m.student_groups[0] : m.student_groups;
      if (sg && sg.teacher_id !== teacherId) otherActive.add(m.student_id);
    }
    for (const s of (studs ?? []) as unknown as Array<{ id: string; subscription_status: string | null; users: { active: boolean } | Array<{ active: boolean }> }>) {
      const u = Array.isArray(s.users) ? s.users[0] : s.users;
      st[studentState({
        userActive: !!u?.active,
        subscriptionStatus: s.subscription_status,
        hasActiveGroupWithTeacher: withTeacherActive.has(s.id),
        hasActiveGroupWithOther: otherActive.has(s.id),
      })]++;
    }
  }
  const churnBase = st.active + st.paused + st.finished + st.churned;

  // ── 3. Horas y dinero ────────────────────────────────────────────────
  const logs = await fetchAll<{ duration_minutes: number | null; amount_cents: number }>((from, to) => {
    let q = sb.from("class_hours_log").select("duration_minutes, amount_cents").eq("teacher_id", teacherId).order("created_at").range(from, to);
    if (sinceIso) q = q.gte("created_at", sinceIso);
    return q;
  });
  const regularMin = logs.reduce((a, r) => a + Number(r.duration_minutes ?? 0), 0);
  const classesCents = logs.reduce((a, r) => a + Number(r.amount_cents ?? 0), 0);

  const coms = await fetchAll<{ monto_cents: number }>((from, to) => {
    let q = sb.from("comisiones").select("monto_cents").eq("usuario_id", teacherUserId).eq("rol", "teacher").order("created_at").range(from, to);
    if (sinceIso) q = q.gte("created_at", sinceIso);
    return q;
  });
  const commissionsCents = coms.reduce((a, r) => a + Number(r.monto_cents ?? 0), 0);

  const totalMin = hours.trialAttendedMin + hours.trialAbsentMin + hours.trialUnmarkedMin + regularMin;
  const totalCents = classesCents + commissionsCents;

  return {
    since: sinceIso,
    funnel: {
      leads: latest.size,
      attended: f.attended,
      absent: f.absent,
      unmarked: f.unmarked,
      pending: f.pending,
      cancelledOnly,
      attendanceRate: pct(f.attended, f.attended + f.absent),
      conversions: f.conversions,
      conversionRate: pct(f.conversions, f.attended),
    },
    students: {
      total: studentIds.length,
      ...st,
      churnRate: pct(st.churned, churnBase),
    },
    hours: { ...hours, regularMin, regularClasses: logs.length, totalMin },
    earnings: {
      classesCents,
      commissionsCents,
      totalCents,
      perHourCents: totalMin > 0 ? Math.round(totalCents / (totalMin / 60)) : null,
      perClassHourCents: regularMin > 0 ? Math.round(classesCents / (regularMin / 60)) : null,
    },
  };
}

export type MetricsPeriod = "todo" | "90" | "30" | "mes";

export function periodSince(p: MetricsPeriod, now: Date = new Date()): Date | null {
  if (p === "90") return new Date(now.getTime() - 90 * 24 * H);
  if (p === "30") return new Date(now.getTime() - 30 * 24 * H);
  if (p === "mes") {
    // Primer día del mes en curso, hora de Berlín.
    const ym = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit" }).format(now);
    const utcGuess = new Date(`${ym}-01T00:00:00Z`);
    const offsetH = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", hour: "2-digit", hour12: false }).format(utcGuess));
    return new Date(utcGuess.getTime() - offsetH * H);
  }
  return null;
}

export function parsePeriod(raw: string | string[] | undefined): MetricsPeriod {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === "90" || v === "30" || v === "mes" ? v : "todo";
}
