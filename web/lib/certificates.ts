import { supabaseAdmin } from "./supabase";
import { createNotification } from "./notifications";

export type CertificateType =
  | "classes_50" | "classes_100"
  | "level_a2" | "level_b1" | "level_b2" | "level_c1"
  | "exam_passed";

export type CertificateRow = {
  id:           string;
  student_id:   string;
  type:         CertificateType;
  title:        string;
  description:  string | null;
  extra_label:  string | null;
  issued_at:    string;
  issued_by:    string | null;
};

export function certificateTitle(type: CertificateType, extraLabel?: string | null): {
  title: string; description: string;
} {
  switch (type) {
    case "classes_50":
      return { title: "50 clases completadas",  description: "Por haber completado 50 clases con asistencia en Aprender-Aleman.de" };
    case "classes_100":
      return { title: "100 clases completadas", description: "Por haber completado 100 clases con asistencia en Aprender-Aleman.de" };
    case "level_a2":
      return { title: "Nivel A2 alcanzado", description: "Demuestra competencia comunicativa en tareas cotidianas." };
    case "level_b1":
      return { title: "Nivel B1 alcanzado", description: "Usuario independiente del idioma alemán." };
    case "level_b2":
      return { title: "Nivel B2 alcanzado", description: "Usuario independiente avanzado — listo para estudio/trabajo en DACH." };
    case "level_c1":
      return { title: "Nivel C1 alcanzado", description: "Usuario competente — fluidez y precisión en contextos profesionales." };
    case "exam_passed":
      return { title: `Examen oficial aprobado${extraLabel ? ` — ${extraLabel}` : ""}`, description: "Superado con éxito en el centro oficial correspondiente." };
  }
}

/**
 * Check milestone triggers for a student and auto-issue certificates if
 * they've crossed a threshold. Called after attendance is marked.
 *
 * Idempotent via the UNIQUE(student_id, type, extra_label) index.
 */
export async function checkAndIssueAutoCertificates(studentId: string): Promise<CertificateType[]> {
  const sb = supabaseAdmin();

  // How many classes has this student attended?
  const { count: attendedCount } = await sb
    .from("class_participants")
    .select("class_id", { count: "exact", head: true })
    .eq("student_id", studentId)
    .eq("attended", true);

  const issued: CertificateType[] = [];
  if (!attendedCount) return issued;

  if (attendedCount >= 50) {
    const ok = await issueIfMissing(studentId, "classes_50", null);
    if (ok) issued.push("classes_50");
  }
  if (attendedCount >= 100) {
    const ok = await issueIfMissing(studentId, "classes_100", null);
    if (ok) issued.push("classes_100");
  }

  return issued;
}

async function issueIfMissing(
  studentId:   string,
  type:        CertificateType,
  extraLabel:  string | null,
  issuedBy:    string | null = null,
): Promise<boolean> {
  const sb = supabaseAdmin();
  const meta = certificateTitle(type, extraLabel);

  const { error } = await sb.from("certificates").insert({
    student_id:  studentId,
    type,
    title:       meta.title,
    description: meta.description,
    extra_label: extraLabel,
    issued_by:   issuedBy,
  });

  // Duplicate (23505) means the cert already existed — not an error, just
  // the idempotent no-op we want.
  if (error) {
    if (/duplicate key|23505|already exists/i.test(error.message)) return false;
    console.error("certificate insert failed:", error.message);
    return false;
  }

  // Notify the student.
  const { data: student } = await sb
    .from("students")
    .select("user_id")
    .eq("id", studentId)
    .maybeSingle();
  const userId = (student as { user_id?: string } | null)?.user_id;
  if (userId) {
    await createNotification({
      user_id:  userId,
      type:     "generic",
      title:    `🎉 ¡Nuevo certificado: ${meta.title}!`,
      body:     "Lo tienes disponible en tu sección de certificados.",
      link:     "/estudiante/certificados",
      class_id: null,
    });
  }
  return true;
}

/**
 * Admin-triggered certificate (e.g. "Exam passed — Goethe B2"). Bypasses
 * the auto-trigger thresholds.
 */
export async function issueCertificateManually(args: {
  studentId:  string;
  type:       CertificateType;
  extraLabel: string | null;
  issuedBy:   string;
}): Promise<CertificateRow | null> {
  const sb = supabaseAdmin();
  const meta = certificateTitle(args.type, args.extraLabel);

  const { data, error } = await sb
    .from("certificates")
    .insert({
      student_id:  args.studentId,
      type:        args.type,
      title:       meta.title,
      description: meta.description,
      extra_label: args.extraLabel,
      issued_by:   args.issuedBy,
    })
    .select("id, student_id, type, title, description, extra_label, issued_at, issued_by")
    .single();

  if (error) {
    if (/duplicate key|23505/i.test(error.message)) return null;   // already have it
    throw new Error(error.message);
  }

  // Notify the student.
  const { data: student } = await sb
    .from("students")
    .select("user_id")
    .eq("id", args.studentId)
    .maybeSingle();
  const userId = (student as { user_id?: string } | null)?.user_id;
  if (userId) {
    await createNotification({
      user_id:  userId,
      type:     "generic",
      title:    `🎉 ¡Nuevo certificado: ${meta.title}!`,
      body:     "Disponible en tu sección de certificados.",
      link:     "/estudiante/certificados",
      class_id: null,
    });
  }

  return data as CertificateRow;
}

export async function listStudentCertificates(studentId: string): Promise<CertificateRow[]> {
  const sb = supabaseAdmin();
  const { data } = await sb
    .from("certificates")
    .select("id, student_id, type, title, description, extra_label, issued_at, issued_by")
    .eq("student_id", studentId)
    .order("issued_at", { ascending: false });
  return (data ?? []) as CertificateRow[];
}

export async function getCertificateById(id: string): Promise<CertificateRow | null> {
  const sb = supabaseAdmin();
  const { data } = await sb
    .from("certificates")
    .select("id, student_id, type, title, description, extra_label, issued_at, issued_by")
    .eq("id", id)
    .maybeSingle();
  return (data as CertificateRow | null) ?? null;
}
