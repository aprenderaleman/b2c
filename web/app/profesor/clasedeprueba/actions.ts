"use server";

import { auth } from "@/lib/auth";
import { getTeacherByUserId } from "@/lib/academy";
import { supabaseAdmin } from "@/lib/supabase";

export async function saveTeacherNotes(classId: string, notes: string) {
  const session = await auth();
  if (!session?.user) throw new Error("unauthorized");

  const user = session.user as { id: string; role?: string };
  const role = user.role;
  if (!role || !["teacher", "admin", "superadmin"].includes(role)) {
    throw new Error("forbidden");
  }

  const teacher = await getTeacherByUserId(user.id);
  if (!teacher) throw new Error("no_teacher_profile");

  const sb = supabaseAdmin();

  const { data: cls } = await sb
    .from("classes")
    .select("id, lead_id, teacher_id")
    .eq("id", classId)
    .eq("is_trial", true)
    .eq("teacher_id", teacher.id)
    .maybeSingle();

  if (!cls) throw new Error("not_owner");

  const { data: existing } = await sb
    .from("trial_class_scripts")
    .select("id")
    .eq("class_id", classId)
    .maybeSingle();

  if (existing) {
    await sb
      .from("trial_class_scripts")
      .update({ teacher_notes: notes })
      .eq("id", existing.id);
  } else {
    await sb.from("trial_class_scripts").insert({
      class_id:      classId,
      lead_id:       cls.lead_id,
      teacher_id:    user.id,
      current_step:  0,
      teacher_notes: notes,
    });
  }
}
