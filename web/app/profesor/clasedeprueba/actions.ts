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

  const { data: userRow } = await sb
    .from("users")
    .select("full_name")
    .eq("id", user.id)
    .maybeSingle();
  const teacherName = userRow?.full_name ?? user.id;

  const { data: existing } = await sb
    .from("trial_class_scripts")
    .select("id")
    .eq("class_id", classId)
    .maybeSingle();

  const now = new Date().toISOString();

  if (existing) {
    await sb
      .from("trial_class_scripts")
      .update({ teacher_notes: notes, updated_at: now })
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

  if (cls.lead_id) {
    await sb.from("lead_timeline").insert({
      lead_id:   cls.lead_id,
      type:      "teacher_note",
      author:    teacherName,
      content:   notes,
      timestamp: now,
    });
  }
}
