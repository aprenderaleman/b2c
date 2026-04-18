import { supabaseAdmin } from "./supabase";

export type HomeworkStatus = "submitted" | "reviewed" | "needs_revision";
export type HomeworkGrade  = "A" | "B" | "C" | "D" | "F";

export type HomeworkAssignment = {
  id:           string;
  class_id:     string;
  teacher_id:   string;
  title:        string;
  description:  string | null;
  due_date:     string | null;
  attachments:  Array<{ url: string; name: string }>;
  created_at:   string;
};

export type HomeworkSubmission = {
  id:                string;
  assignment_id:     string;
  student_id:        string;
  content:           string | null;
  attachments:       Array<{ url: string; name: string }>;
  status:            HomeworkStatus;
  teacher_feedback:  string | null;
  grade:             HomeworkGrade | null;
  submitted_at:      string;
  reviewed_at:       string | null;
};

// =============================================================================
// Queries
// =============================================================================

/**
 * Homework assigned for a given class (teacher view on class detail).
 */
export async function getClassHomework(classId: string): Promise<Array<HomeworkAssignment & {
  submissions: Array<HomeworkSubmission & { student_name: string | null; student_email: string }>;
}>> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("homework_assignments")
    .select(`
      id, class_id, teacher_id, title, description, due_date, attachments, created_at,
      homework_submissions(
        id, assignment_id, student_id, content, attachments, status,
        teacher_feedback, grade, submitted_at, reviewed_at,
        student:students!inner(users!inner(full_name, email))
      )
    `)
    .eq("class_id", classId)
    .order("created_at", { ascending: false });
  if (error) return [];

  return (data ?? []).map(a => {
    const subs = ((a as { homework_submissions: unknown[] }).homework_submissions ?? []) as Array<Record<string, unknown>>;
    return {
      id:           (a as { id: string }).id,
      class_id:     (a as { class_id: string }).class_id,
      teacher_id:   (a as { teacher_id: string }).teacher_id,
      title:        (a as { title: string }).title,
      description:  (a as { description: string | null }).description,
      due_date:     (a as { due_date: string | null }).due_date,
      attachments:  Array.isArray((a as { attachments?: unknown }).attachments) ? (a as { attachments: HomeworkAssignment["attachments"] }).attachments : [],
      created_at:   (a as { created_at: string }).created_at,
      submissions:  subs.map(s => {
        const stu = s.student;
        const sFlat = Array.isArray(stu) ? stu[0] : stu;
        const u = (sFlat as { users: unknown } | null)?.users;
        const uu = (Array.isArray(u) ? u[0] : u) as { full_name: string | null; email: string } | undefined;
        return {
          id:               s.id as string,
          assignment_id:    s.assignment_id as string,
          student_id:       s.student_id as string,
          content:          (s.content as string | null) ?? null,
          attachments:      Array.isArray(s.attachments) ? (s.attachments as HomeworkSubmission["attachments"]) : [],
          status:           (s.status as HomeworkStatus),
          teacher_feedback: (s.teacher_feedback as string | null) ?? null,
          grade:            (s.grade as HomeworkGrade | null) ?? null,
          submitted_at:     s.submitted_at as string,
          reviewed_at:      (s.reviewed_at as string | null) ?? null,
          student_name:     uu?.full_name ?? null,
          student_email:    uu?.email ?? "",
        };
      }),
    };
  });
}

/**
 * Assignments visible to a given student — looks up every class they're in
 * and returns every assignment attached to those classes, plus the student's
 * own submission (if any).
 */
export async function getStudentHomework(studentId: string): Promise<Array<HomeworkAssignment & {
  class_title: string;
  submission:  HomeworkSubmission | null;
}>> {
  const sb = supabaseAdmin();

  // Classes the student is in.
  const { data: parts } = await sb
    .from("class_participants")
    .select("class_id")
    .eq("student_id", studentId);
  const classIds = (parts ?? []).map(p => (p as { class_id: string }).class_id);
  if (classIds.length === 0) return [];

  const { data, error } = await sb
    .from("homework_assignments")
    .select(`
      id, class_id, teacher_id, title, description, due_date, attachments, created_at,
      class:classes!inner(title),
      homework_submissions(
        id, assignment_id, student_id, content, attachments, status,
        teacher_feedback, grade, submitted_at, reviewed_at
      )
    `)
    .in("class_id", classIds)
    .order("created_at", { ascending: false });
  if (error) return [];

  return (data ?? []).map(a => {
    const c = (a as { class: unknown }).class;
    const cFlat = Array.isArray(c) ? c[0] : c;
    const subs = ((a as { homework_submissions: unknown[] }).homework_submissions ?? []) as Array<Record<string, unknown>>;
    const mine = subs.find(s => s.student_id === studentId);
    return {
      id:           (a as { id: string }).id,
      class_id:     (a as { class_id: string }).class_id,
      teacher_id:   (a as { teacher_id: string }).teacher_id,
      title:        (a as { title: string }).title,
      description:  (a as { description: string | null }).description,
      due_date:     (a as { due_date: string | null }).due_date,
      attachments:  Array.isArray((a as { attachments?: unknown }).attachments) ? (a as { attachments: HomeworkAssignment["attachments"] }).attachments : [],
      created_at:   (a as { created_at: string }).created_at,
      class_title:  (cFlat as { title: string } | undefined)?.title ?? "",
      submission:   mine ? {
        id:               mine.id as string,
        assignment_id:    mine.assignment_id as string,
        student_id:       mine.student_id as string,
        content:          (mine.content as string | null) ?? null,
        attachments:      Array.isArray(mine.attachments) ? (mine.attachments as HomeworkSubmission["attachments"]) : [],
        status:           (mine.status as HomeworkStatus),
        teacher_feedback: (mine.teacher_feedback as string | null) ?? null,
        grade:            (mine.grade as HomeworkGrade | null) ?? null,
        submitted_at:     mine.submitted_at as string,
        reviewed_at:      (mine.reviewed_at as string | null) ?? null,
      } : null,
    };
  });
}

export async function getAssignmentById(id: string): Promise<HomeworkAssignment | null> {
  const sb = supabaseAdmin();
  const { data } = await sb
    .from("homework_assignments")
    .select("id, class_id, teacher_id, title, description, due_date, attachments, created_at")
    .eq("id", id)
    .maybeSingle();
  return (data as HomeworkAssignment | null) ?? null;
}
