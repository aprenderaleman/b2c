"use server";

import { auth } from "@/lib/auth";
import { getTeacherByUserId } from "@/lib/academy";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * Resultado estructurado (2026-09-14): antes la action LANZABA errores
 * y Next los censura en producción ("An error occurred…"), así que el
 * profe solo veía "Error al guardar — reintentando..." sin causa y
 * nosotros no teníamos ni un log útil. Ahora devuelve { ok, error } y
 * el UI muestra el motivo real.
 */
export type SaveNotesResult = { ok: true } | { ok: false; error: string };

export async function saveTeacherNotes(classId: string, notes: string): Promise<SaveNotesResult> {
  try {
    return await saveTeacherNotesInner(classId, notes);
  } catch (e) {
    console.error("[saveTeacherNotes] unexpected:", e);
    return { ok: false, error: e instanceof Error ? e.message : "error_inesperado" };
  }
}

async function saveTeacherNotesInner(classId: string, notes: string): Promise<SaveNotesResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Sesión expirada — recarga la página e inicia sesión." };

  const user = session.user as { id: string; role?: string };
  const role = user.role;
  if (!role || !["teacher", "admin", "superadmin"].includes(role)) {
    return { ok: false, error: "Tu rol no puede guardar notas de prueba." };
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
    if (!teacher) return { ok: false, error: "Tu cuenta no tiene perfil de profesor." };
    query = query.eq("teacher_id", teacher.id);
  }

  const { data: cls, error: clsErr } = await query.maybeSingle();
  if (clsErr) return { ok: false, error: `No se pudo leer la clase: ${clsErr.message}` };
  if (!cls) {
    return {
      ok: false,
      error: "Esta clase de prueba ya no está asignada a ti (¿reasignada o cancelada?). Recarga la página.",
    };
  }

  // La nota se atribuye SIEMPRE al profesor de la clase, no al user
  // de sesión. Si Gelfis (admin) edita desde /admin/clasedeprueba en
  // nombre del profe, la nota debe aparecer con el nombre del profe
  // real que dio (o dará) la clase — es SU trabajo. Fallback al user
  // de sesión sólo si la clase no tiene teacher asignado (edge case).
  const { data: teacherUserRow } = cls.teacher_id
    ? await sb
        .from("teachers")
        .select("users:user_id (full_name)")
        .eq("id", cls.teacher_id)
        .maybeSingle()
    : { data: null };
  const teacherFullName = (teacherUserRow as { users: { full_name: string | null } | null } | null)
    ?.users?.full_name ?? null;

  const { data: sessionUserRow } = await sb
    .from("users")
    .select("full_name")
    .eq("id", user.id)
    .maybeSingle();
  const teacherName = teacherFullName ?? sessionUserRow?.full_name ?? user.id;

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
    if (error) return { ok: false, error: `No se pudo actualizar: ${error.message}` };
  } else {
    if (!cls.lead_id) {
      return { ok: false, error: "Esta clase de prueba no tiene lead asociado — avisa al admin." };
    }
    const { error } = await sb.from("trial_class_scripts").insert({
      class_id:      classId,
      lead_id:       cls.lead_id,
      teacher_id:    user.id,
      current_step:  0,
      teacher_notes: notes,
    });
    if (error) return { ok: false, error: `No se pudo guardar: ${error.message}` };
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

  return { ok: true };
}
