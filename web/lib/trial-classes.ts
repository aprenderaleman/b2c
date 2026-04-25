import { supabaseAdmin } from "./supabase";

/**
 * Shared loader for the trial-class lists shown to admin
 * (/admin/clasedeprueba) and teacher (/profesor/clasedeprueba).
 *
 * Pulls the booking row + the lead's contact info + the teacher's
 * display name. Returns rows pre-flattened so the page components
 * don't need to massage Supabase's nested-array shape.
 */

export type TrialClassRow = {
  classId:            string;
  scheduledAt:        string;
  durationMinutes:    number;
  status:             string;
  shortCode:          string | null;
  notesAdmin:         string | null;
  leadId:             string | null;
  leadName:           string | null;
  leadEmail:          string | null;
  leadWhatsapp:       string | null;
  leadLanguage:       "es" | "de" | null;
  leadGermanLevel:    string | null;
  leadGoal:           string | null;
  teacherId:          string;
  teacherName:        string;
  teacherEmail:       string;
};

/**
 * @param teacherId - if provided, scope to that teacher only.
 *                    Omit for the admin view (returns all trials).
 */
export async function listTrialClasses(teacherId?: string): Promise<TrialClassRow[]> {
  const sb = supabaseAdmin();

  let q = sb
    .from("classes")
    .select(`
      id, scheduled_at, duration_minutes, status, short_code, notes_admin,
      teacher_id,
      teacher:teachers!inner(users!inner(full_name, email)),
      lead:leads(id, name, email, whatsapp_normalized, language, german_level, goal)
    `)
    .eq("is_trial", true)
    .order("scheduled_at", { ascending: true });

  if (teacherId) q = q.eq("teacher_id", teacherId);

  const { data, error } = await q;
  if (error) throw error;

  type Raw = {
    id: string;
    scheduled_at: string;
    duration_minutes: number;
    status: string;
    short_code: string | null;
    notes_admin: string | null;
    teacher_id: string;
    teacher: { users: { full_name: string | null; email: string } |
                       Array<{ full_name: string | null; email: string }> } |
             Array<{ users: { full_name: string | null; email: string } |
                            Array<{ full_name: string | null; email: string }> }>;
    lead: {
      id: string;
      name: string | null;
      email: string | null;
      whatsapp_normalized: string | null;
      language: "es" | "de" | null;
      german_level: string | null;
      goal: string | null;
    } | Array<{
      id: string;
      name: string | null;
      email: string | null;
      whatsapp_normalized: string | null;
      language: "es" | "de" | null;
      german_level: string | null;
      goal: string | null;
    }> | null;
  };
  const flat = <T,>(x: T | T[] | null | undefined): T | null =>
    !x ? null : Array.isArray(x) ? x[0] ?? null : x;

  return (data ?? []).map((r) => {
    const row = r as Raw;
    const teacherWrap = flat(row.teacher);
    const tu = teacherWrap ? flat(teacherWrap.users) : null;
    const lead = flat(row.lead);
    return {
      classId:         row.id,
      scheduledAt:     row.scheduled_at,
      durationMinutes: row.duration_minutes ?? 45,
      status:          row.status,
      shortCode:       row.short_code,
      notesAdmin:      row.notes_admin,
      leadId:          lead?.id ?? null,
      leadName:        lead?.name ?? null,
      leadEmail:       lead?.email ?? null,
      leadWhatsapp:    lead?.whatsapp_normalized ?? null,
      leadLanguage:    lead?.language ?? null,
      leadGermanLevel: lead?.german_level ?? null,
      leadGoal:        lead?.goal ?? null,
      teacherId:       row.teacher_id,
      teacherName:     tu?.full_name ?? tu?.email ?? "—",
      teacherEmail:    tu?.email ?? "",
    };
  });
}

export function partitionByTime(rows: TrialClassRow[]) {
  const now = Date.now();
  const upcoming: TrialClassRow[] = [];
  const past:     TrialClassRow[] = [];
  for (const r of rows) {
    if (new Date(r.scheduledAt).getTime() >= now) upcoming.push(r);
    else past.push(r);
  }
  // Past: newest first.
  past.reverse();
  return { upcoming, past };
}

/** Pretty Spanish weekday + date in Berlin TZ. */
export function formatBerlinDate(iso: string): string {
  return new Date(iso).toLocaleString("es-ES", {
    timeZone: "Europe/Berlin",
    weekday:  "long",
    day:      "numeric",
    month:    "short",
  });
}

export function formatBerlinTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-ES", {
    timeZone: "Europe/Berlin",
    hour:     "2-digit",
    minute:   "2-digit",
  });
}

/** Spanish-friendly status label. */
export function formatStatusEs(status: string): string {
  switch (status) {
    case "scheduled": return "Agendada";
    case "live":      return "En curso";
    case "completed": return "Completada";
    case "cancelled": return "Cancelada";
    default:          return status;
  }
}

/** Goal → label, mirrors the funnel options. */
export function formatGoalEs(goal: string | null): string {
  switch (goal) {
    case "work":            return "Trabajo";
    case "visa":            return "Visa";
    case "studies":         return "Estudios";
    case "exam":            return "Examen oficial";
    case "travel":          return "Viaje";
    case "already_in_dach": return "Ya en DACH";
    default:                return goal ?? "—";
  }
}
