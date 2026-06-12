/**
 * Capa de servidor para el wizard /cp/[classId] — guion de la clase
 * de prueba para profesores. Toda la mutación pasa por aquí.
 *
 * Reglas:
 *   - 1 script por clase (UNIQUE class_id). Si el profe entra por
 *     segunda vez se reanuda el mismo.
 *   - Auto-save por paso: el wizard envía un payload parcial tras
 *     "Siguiente" y guardamos solo los campos presentes.
 *   - Acceso: profe asignado a la clase + superadmin. Otros: 403.
 *
 * Se consume desde la página y el wizard de /cp/[classId] vía
 * Server Actions ("use server" wrappers en el componente).
 */

import { supabaseAdmin } from "./supabase";
import type { PackId, PaymentType, ScheduleType, LearningGoal } from "./trial-packs";

export type ScriptRow = {
  id:              string;
  class_id:        string;
  lead_id:         string;
  teacher_id:      string;
  started_at:      string;
  completed_at:    string | null;
  current_step:    number;
  objetivo:        string | null;
  nivel_objetivo:  string | null;
  deadline:        string | null;
  motivacion:      string | null;
  feedback_clase:  string | null;
  feedback_gusto:  string | null;
  enrollment_sense: boolean | null;
  objection_reason:  string | null;
  objection_unblock: string | null;
  schedule_type:   ScheduleType | null;
  learning_goal:   LearningGoal | null;
  presented_packs: PackId[] | null;
  chosen_pack:     PackId | null;
  payment_type:    PaymentType | null;
  closing_yes:     boolean | null;
  final_outcome:   "attended" | "absent" | null;
  final_marked_at: string | null;
  teacher_notes:   string | null;
};

export type ClassContext = {
  classId:        string;
  leadId:         string;
  teacherUserId:  string;
  scheduledAt:    string;
  durationMin:    number;
  isTrial:        boolean;
  lead: {
    name:         string | null;
    email:        string | null;
    whatsapp:     string | null;
    language:     "es" | "de" | null;
    germanLevel:  string | null;
    motivo:       string | null;
  };
  teacherName: string | null;
};

/**
 * Carga el contexto de la clase + lead + profesor. Devuelve null si
 * la clase no existe, no es trial, o no tiene lead asociado.
 */
export async function getClassContext(classId: string): Promise<ClassContext | null> {
  const sb = supabaseAdmin();
  // OJO: classes.teacher_id apunta a teachers(id), NO a users(id).
  // Para resolver el user_id (que es lo que comparamos con la sesión
  // y guardamos en trial_class_scripts) tenemos que pasar por teachers.
  const { data, error } = await sb
    .from("classes")
    .select(`
      id, scheduled_at, duration_minutes, is_trial, teacher_id, lead_id,
      teacher:teachers ( user_id, users:users ( full_name ) ),
      lead:leads (
        name, email, whatsapp_normalized, language, german_level, motivo_inicial
      )
    `)
    .eq("id", classId)
    .maybeSingle();

  if (error || !data) return null;
  type TeacherJoin = {
    user_id: string;
    users: { full_name: string | null } | Array<{ full_name: string | null }> | null;
  };
  type LeadJoin = {
    name: string | null; email: string | null; whatsapp_normalized: string | null;
    language: "es" | "de" | null; german_level: string | null; motivo_inicial: string | null;
  };
  const row = data as unknown as {
    id: string; scheduled_at: string; duration_minutes: number; is_trial: boolean;
    teacher_id: string | null; lead_id: string | null;
    teacher: TeacherJoin | Array<TeacherJoin> | null;
    lead:    LeadJoin    | Array<LeadJoin>    | null;
  };

  if (!row.is_trial || !row.lead_id) return null;
  const t = Array.isArray(row.teacher) ? row.teacher[0] : row.teacher;
  const l = Array.isArray(row.lead)    ? row.lead[0]    : row.lead;
  if (!l || !t) return null;
  const tUser = Array.isArray(t.users) ? t.users[0] : t.users;

  return {
    classId:       row.id,
    leadId:        row.lead_id,
    teacherUserId: t.user_id,                // ← user_id, no teachers.id
    scheduledAt:   row.scheduled_at,
    durationMin:   row.duration_minutes,
    isTrial:       row.is_trial,
    teacherName:   tUser?.full_name ?? null,
    lead: {
      name:         l.name,
      email:        l.email,
      whatsapp:     l.whatsapp_normalized,
      language:     l.language,
      germanLevel:  l.german_level,
      motivo:       l.motivo_inicial,
    },
  };
}

/**
 * Carga el script existente para la clase, o lo crea si no existe.
 * Si lo crea, hereda teacherUserId del caller (validado externamente).
 */
export async function startOrLoadScript(
  classId:    string,
  leadId:     string,
  teacherId:  string,
): Promise<ScriptRow> {
  const sb = supabaseAdmin();
  const { data: existing } = await sb
    .from("trial_class_scripts")
    .select("*")
    .eq("class_id", classId)
    .maybeSingle();
  if (existing) return existing as ScriptRow;

  const { data: created, error } = await sb
    .from("trial_class_scripts")
    .insert({
      class_id:   classId,
      lead_id:    leadId,
      teacher_id: teacherId,
      current_step: 1,
    })
    .select("*")
    .single();
  if (error || !created) {
    throw new Error(`Failed to create trial script: ${error?.message ?? "unknown"}`);
  }
  return created as ScriptRow;
}

export type ScriptPatch = Partial<Omit<ScriptRow,
  "id" | "class_id" | "lead_id" | "teacher_id" | "started_at"
>>;

/**
 * Persiste cambios parciales del script. El wizard llama a esta
 * función tras cada "Siguiente" con SOLO los campos del paso actual
 * y el `current_step` próximo.
 */
export async function saveScriptStep(
  scriptId: string,
  patch:    ScriptPatch,
): Promise<void> {
  const sb = supabaseAdmin();
  const { error } = await sb
    .from("trial_class_scripts")
    .update(patch)
    .eq("id", scriptId);
  if (error) throw new Error(`saveScriptStep: ${error.message}`);
}

/**
 * Marca el script como completado y graba el outcome. Llamado desde
 * el paso final del wizard (botones "Asistió" / "No asistió").
 *
 * El registro en lead_timeline lo hace markTrialAttendedAwaitingConversion
 * / markTrialAbsent en lib/admin-actions.ts — esta función solo
 * actualiza la fila del script. El caller orquesta ambos.
 */
export async function completeScript(
  scriptId: string,
  outcome:  "attended" | "absent",
): Promise<void> {
  const sb = supabaseAdmin();
  const nowIso = new Date().toISOString();
  const { error } = await sb
    .from("trial_class_scripts")
    .update({
      final_outcome:    outcome,
      final_marked_at:  nowIso,
      completed_at:     nowIso,
    })
    .eq("id", scriptId);
  if (error) throw new Error(`completeScript: ${error.message}`);
}

/**
 * Decide si un user puede acceder al wizard de esa clase:
 *   - superadmin → siempre
 *   - teacher asignado a la clase → sí
 *   - resto → no
 *
 * Decisión Gelfis 2026-06-08: solo el profe asignado (no cualquier
 * profe). Si hay sustitución, el admin reasigna la clase primero.
 */
export function canAccessTrialScript(
  ctx:    ClassContext,
  userId: string,
  role:   "superadmin" | "admin" | "teacher" | "student",
): boolean {
  if (role === "superadmin") return true;
  if (role === "teacher")    return ctx.teacherUserId === userId;
  return false;
}
