import { supabaseAdmin } from "./supabase";

export type TeacherNoteType = "class_summary" | "progress" | "behavior" | "general";

export type TeacherStudentNote = {
  id:          string;
  teacher_id:  string;
  student_id:  string;
  class_id:    string | null;
  note_type:   TeacherNoteType;
  content:     string;
  created_at:  string;
  teacher_name: string | null;
  class_title: string | null;
};

export async function listNotesForStudent(studentId: string, teacherId?: string): Promise<TeacherStudentNote[]> {
  const sb = supabaseAdmin();
  let q = sb
    .from("teacher_student_notes")
    .select(`
      id, teacher_id, student_id, class_id, note_type, content, created_at,
      teacher:teachers!inner(users!inner(full_name)),
      class:classes(title)
    `)
    .eq("student_id", studentId)
    .order("created_at", { ascending: false });
  if (teacherId) q = q.eq("teacher_id", teacherId);
  const { data, error } = await q;
  if (error) return [];

  return (data ?? []).map(r => {
    const t = (r as { teacher: unknown }).teacher;
    const tFlat = Array.isArray(t) ? t[0] : t;
    const u = (tFlat as { users: unknown } | null)?.users;
    const uu = (Array.isArray(u) ? u[0] : u) as { full_name: string | null } | undefined;
    const c = (r as { class: unknown }).class;
    const cFlat = Array.isArray(c) ? c[0] : c;
    return {
      id:           (r as { id: string }).id,
      teacher_id:   (r as { teacher_id: string }).teacher_id,
      student_id:   (r as { student_id: string }).student_id,
      class_id:     (r as { class_id: string | null }).class_id,
      note_type:    (r as { note_type: TeacherNoteType }).note_type,
      content:      (r as { content: string }).content,
      created_at:   (r as { created_at: string }).created_at,
      teacher_name: uu?.full_name ?? null,
      class_title:  (cFlat as { title?: string } | null)?.title ?? null,
    };
  });
}

export async function createTeacherNote(args: {
  teacherId:  string;
  studentId:  string;
  classId:    string | null;
  noteType:   TeacherNoteType;
  content:    string;
}): Promise<void> {
  const sb = supabaseAdmin();
  const { error } = await sb.from("teacher_student_notes").insert({
    teacher_id:  args.teacherId,
    student_id:  args.studentId,
    class_id:    args.classId,
    note_type:   args.noteType,
    content:     args.content,
  });
  if (error) throw new Error(error.message);
}

// =============================================================================
// Student progress tracking
// =============================================================================

export type SkillType = "speaking" | "writing" | "reading" | "listening" | "grammar" | "vocabulary";

export type StudentSkillScore = {
  skill:        SkillType;
  level_score:  number;        // 0-100
  updated_at:   string;
  updated_by:   string | null;
};

export async function getStudentProgress(studentId: string): Promise<StudentSkillScore[]> {
  const sb = supabaseAdmin();
  const { data } = await sb
    .from("student_progress")
    .select("skill, level_score, updated_at, updated_by")
    .eq("student_id", studentId);

  const scores = (data ?? []) as StudentSkillScore[];

  // Fill in zero-scores for skills that don't yet have a row so the UI
  // always shows all six bars.
  const ALL: SkillType[] = ["speaking", "writing", "reading", "listening", "grammar", "vocabulary"];
  const byKey: Record<string, StudentSkillScore> = Object.fromEntries(scores.map(s => [s.skill, s]));
  return ALL.map(sk => byKey[sk] ?? ({
    skill:       sk,
    level_score: 0,
    updated_at:  new Date(0).toISOString(),
    updated_by:  null,
  } as StudentSkillScore));
}

export async function setStudentSkillScore(args: {
  studentId:   string;
  skill:       SkillType;
  score:       number;
  updatedBy:   string;
}): Promise<void> {
  const sb = supabaseAdmin();
  const clamped = Math.max(0, Math.min(100, Math.round(args.score)));
  const { error } = await sb.from("student_progress").upsert(
    {
      student_id:   args.studentId,
      skill:        args.skill,
      level_score:  clamped,
      updated_at:   new Date().toISOString(),
      updated_by:   args.updatedBy,
    },
    { onConflict: "student_id,skill" },
  );
  if (error) throw new Error(error.message);
}

export function skillLabelEs(s: SkillType): string {
  return ({
    speaking:    "Hablar",
    writing:     "Escribir",
    reading:     "Leer",
    listening:   "Escuchar",
    grammar:     "Gramática",
    vocabulary:  "Vocabulario",
  } as Record<SkillType, string>)[s];
}

export function noteTypeLabelEs(n: TeacherNoteType): string {
  return ({
    class_summary: "Resumen de clase",
    progress:      "Progreso",
    behavior:      "Comportamiento",
    general:       "General",
  } as Record<TeacherNoteType, string>)[n];
}
