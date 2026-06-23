import { auth } from "./auth";
import { getTeacherByUserId } from "./academy";
import { supabaseAdmin } from "./supabase";

export async function assertTeacherOwnsTrialLead(
  userId: string,
  leadId: string,
): Promise<{ teacherId: string; teacherName: string | null }> {
  const teacher = await getTeacherByUserId(userId);
  if (!teacher) throw new Error("no_teacher_profile");

  const sb = supabaseAdmin();
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

export async function requireTeacherSession() {
  const session = await auth();
  if (!session?.user) throw new Error("unauthorized");
  const role = (session.user as { role?: string }).role;
  if (!role || !["teacher", "admin", "superadmin"].includes(role)) {
    throw new Error("forbidden");
  }
  return session.user as { id: string; email: string; role: string };
}
