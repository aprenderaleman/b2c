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

  const sb = supabaseAdmin();

  // Admin/superadmin pueden guardar notas en CUALQUIER trial (usan
  // /admin/clasedeprueba, que reutiliza este componente). Los profes
  // solo en las suyas. Caso Gelfis 2026-08-08: "Error al guardar
  // notas" porque el check exigía perfil de profesor + ownership.
  const isAdmin = role === "admin" || role === "superadmin";

  let query = sb
    .from("classes")
    .select("id, lead_id, teacher_id")
    .eq("id", classId)
    .eq("is_trial", true);

  if (!isAdmin) {
    const teacher = await getTeacherByUserId(user.id);
    if (!teacher) throw new Error("no_teacher_profile");
    query = query.eq("teacher_id", teacher.id);
  }

  const { data: cls } = await query.maybeSingle();
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

  // OJO: trial_class_scripts NO tiene columna updated_at — incluirla
  // hacía fallar el UPDATE en silencio y las notas "desaparecían"
  // (caso Sabine 2026-08-17: solo sobrevivía el primer fragmento).
  // Los errores se propagan para que el UI muestre el fallo en vez de
  // fingir que guardó.
  if (existing) {
    const { error } = await sb
      .from("trial_class_scripts")
      .update({ teacher_notes: notes })
      .eq("id", existing.id);
    if (error) throw new Error(`notes_update_failed: ${error.message}`);
  } else {
    const { error } = await sb.from("trial_class_scripts").insert({
      class_id:      classId,
      lead_id:       cls.lead_id,
      teacher_id:    user.id,
      current_step:  0,
      teacher_notes: notes,
    });
    if (error) throw new Error(`notes_insert_failed: ${error.message}`);
  }

  if (cls.lead_id) {
    // Anti-spam del autosave (debounce cada 1.5s): si la última entrada
    // del timeline es una teacher_note del mismo autor hace <1h, la
    // ACTUALIZAMOS en vez de insertar otra — así el timeline guarda la
    // versión final de la nota, no 10 fragmentos progresivos.
    const { data: last } = await sb
      .from("lead_timeline")
      .select("id, type, author, timestamp")
      .eq("lead_id", cls.lead_id)
      .order("timestamp", { ascending: false })
      .limit(1)
      .maybeSingle();
    const l = last as { id: string; type: string; author: string; timestamp: string } | null;
    const recentSameAuthor = l
      && l.type === "teacher_note"
      && l.author === teacherName
      && (Date.now() - new Date(l.timestamp).getTime()) < 3600_000;

    if (recentSameAuthor) {
      await sb.from("lead_timeline")
        .update({ content: notes, timestamp: now })
        .eq("id", l.id);
    } else {
      await sb.from("lead_timeline").insert({
        lead_id:   cls.lead_id,
        type:      "teacher_note",
        author:    teacherName,
        content:   notes,
        timestamp: now,
      });
    }
  }
}
