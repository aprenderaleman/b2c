import { auth } from "./auth";
import { getTeacherByUserId } from "./academy";
import { supabaseAdmin } from "./supabase";

export async function assertTeacherOwnsTrialLead(
  userId: string,
  leadId: string,
  role?: string,
): Promise<{ teacherId: string; teacherName: string | null }> {
  const sb = supabaseAdmin();

  // Closer: puede operar sobre SUS leads asignados (Gelfis 2026-08-05:
  // los botones del Trial Hub — enlace, confirmar pago, reagendar — se
  // comparten con el CRM closer). Solo llega aquí desde rutas que pasan
  // allowCloser a requireTeacherSession.
  if (role === "closer") {
    const { data: lead } = await sb
      .from("leads")
      .select("closer_id")
      .eq("id", leadId)
      .maybeSingle();
    if (!lead || (lead as { closer_id: string | null }).closer_id !== userId) {
      throw new Error("not_owner");
    }

    const { data: cls } = await sb
      .from("classes")
      .select("teacher_id")
      .eq("is_trial", true)
      .is("deleted_at", null)
      .eq("lead_id", leadId)
      .limit(1)
      .maybeSingle();

    const { data: userRow } = await sb
      .from("users")
      .select("full_name")
      .eq("id", userId)
      .maybeSingle();

    return {
      teacherId: (cls as { teacher_id: string } | null)?.teacher_id ?? "",
      teacherName: userRow?.full_name ?? null,
    };
  }

  if (role === "admin" || role === "superadmin") {
    const { data: cls } = await sb
      .from("classes")
      .select("teacher_id")
      .eq("is_trial", true)
      .is("deleted_at", null) // soft-delete guard 2026-07-10
      .eq("lead_id", leadId)
      .limit(1)
      .maybeSingle();
    if (!cls) throw new Error("not_found");

    const { data: userRow } = await sb
      .from("users")
      .select("full_name")
      .eq("id", userId)
      .maybeSingle();

    return { teacherId: cls.teacher_id, teacherName: userRow?.full_name ?? null };
  }

  const teacher = await getTeacherByUserId(userId);
  if (!teacher) throw new Error("no_teacher_profile");

  const { data } = await sb
    .from("classes")
    .select("id")
    .eq("is_trial", true)
    .eq("lead_id", leadId)
    .eq("teacher_id", teacher.id)
    .limit(1)
    .maybeSingle();

  if (!data) throw new Error("not_owner");

  const { data: userRow } = await sb
    .from("users")
    .select("full_name")
    .eq("id", userId)
    .maybeSingle();

  return { teacherId: teacher.id, teacherName: userRow?.full_name ?? null };
}

export async function requireTeacherSession(opts?: { allowCloser?: boolean }) {
  const session = await auth();
  if (!session?.user) throw new Error("unauthorized");
  const role = (session.user as { role?: string }).role;
  const allowed = ["teacher", "admin", "superadmin", ...(opts?.allowCloser ? ["closer"] : [])];
  if (!role || !allowed.includes(role)) {
    throw new Error("forbidden");
  }
  return session.user as { id: string; email: string; role: string };
}
