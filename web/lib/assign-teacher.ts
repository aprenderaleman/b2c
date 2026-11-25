import { supabaseAdmin } from "./supabase";
import { ensureDirectChat, sendMessage } from "./chat";
import { ACADEMY_CHAT_EMAIL } from "./chat-display";
import { goalLevelEs, ritmoLabelEs } from "./academy";
import { reassignTeacher } from "./teacher-reassignment";
import {
  fixWelcomeTeacherName, isAssignmentNoticeToStudent, renderAssignmentNotices,
  type AssignmentNotices,
} from "./teacher-assignment-notices";

/**
 * Botón "Asignar profe" de la ficha del estudiante (Gelfis 2026-11-25).
 *
 * Asigna o cambia el profe del alumno (lib/teacher-reassignment.ts: grupo
 * individual, clases futuras, chat profe–alumno, documento de apuntes y
 * registro) y avisa por el chat de la plataforma a los involucrados:
 * alumno (como Stiv), profe nuevo, profe anterior y profe de la prueba.
 *
 * Además deja limpio el chat del alumno con la academia: los avisos de
 * asignación anteriores que el alumno NO ha leído se borran y, si tampoco
 * ha leído la bienvenida, se corrige en ella el nombre del profe. Así solo
 * ve el dato vigente (caso Angela, 3 profes en 2 días sin haber entrado).
 *
 * La comisión no se toca: sigue siendo del profe de la prueba
 * (students.trial_teacher_id).
 */

type TeacherRef = { teacherId: string; userId: string; fullName: string };

export type AssignTeacherOptions = {
  student: { id: string; fullName: string; neverLoggedIn: boolean; hasPhone: boolean; active: boolean };
  currentTeacher: { teacherId: string; fullName: string } | null;
  trialTeacher: { teacherId: string; fullName: string } | null;
  teachers: Array<{ id: string; fullName: string; activeStudents: number }>;
};

export type AssignNotify = { student: boolean; newTeacher: boolean; oldTeacher: boolean; trialTeacher: boolean };

export type AssignPreview = {
  notices: AssignmentNotices;
  recipients: { student: string; newTeacher: string; oldTeacher: string | null; trialTeacher: string | null };
  cleanup: { unreadNoticesToDelete: number; welcomeWillBeFixed: boolean };
};

const firstOf = <T,>(v: T | T[] | null | undefined): T | undefined => (Array.isArray(v) ? v[0] : v ?? undefined);

async function academyUserId(): Promise<string | null> {
  const { data } = await supabaseAdmin().from("users").select("id").eq("email", ACADEMY_CHAT_EMAIL).maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

async function loadStudent(studentId: string) {
  const { data } = await supabaseAdmin().from("students")
    .select("id, user_id, current_level, goal, subscription_type, classes_per_month, monthly_price_cents, trial_teacher_id, users!inner(full_name, email, phone, last_login_at, language_preference, active)")
    .eq("id", studentId).maybeSingle();
  if (!data) return null;
  const s = data as {
    id: string; user_id: string; current_level: string | null; goal: string | null; subscription_type: string;
    classes_per_month: number | null; monthly_price_cents: number | null; trial_teacher_id: string | null; users: unknown;
  };
  const u = firstOf(s.users as { full_name: string | null; email: string; phone: string | null; last_login_at: string | null; language_preference: "es" | "de" | null; active: boolean }
    | Array<{ full_name: string | null; email: string; phone: string | null; last_login_at: string | null; language_preference: "es" | "de" | null; active: boolean }>)!;
  return { ...s, u };
}

async function loadTeacher(teacherId: string): Promise<(TeacherRef & { email: string }) | null> {
  const { data } = await supabaseAdmin().from("teachers").select("id, user_id, users!inner(full_name, email)").eq("id", teacherId).maybeSingle();
  if (!data) return null;
  const t = data as { id: string; user_id: string; users: unknown };
  const u = firstOf(t.users as { full_name: string | null; email: string } | Array<{ full_name: string | null; email: string }>)!;
  return { teacherId: t.id, userId: t.user_id, fullName: u.full_name ?? u.email, email: u.email };
}

/** Profe del grupo individual activo del alumno (el que le da clase hoy). */
async function loadCurrentTeacher(studentId: string): Promise<TeacherRef | null> {
  const { data } = await supabaseAdmin().from("student_group_members")
    .select("student_groups!inner(active, class_type, teacher_id)")
    .eq("student_id", studentId).eq("student_groups.active", true).eq("student_groups.class_type", "individual").limit(1);
  const g = firstOf((data ?? [])[0] ? ((data ?? [])[0] as { student_groups: unknown }).student_groups as { teacher_id: string } | Array<{ teacher_id: string }> : null);
  if (!g?.teacher_id) return null;
  const t = await loadTeacher(g.teacher_id);
  return t ? { teacherId: t.teacherId, userId: t.userId, fullName: t.fullName } : null;
}

async function hasCommission(studentId: string, teacherUserId: string): Promise<boolean> {
  const { count } = await supabaseAdmin().from("comisiones").select("id", { count: "exact", head: true })
    .eq("student_id", studentId).eq("usuario_id", teacherUserId);
  return (count ?? 0) > 0;
}

/** Datos para abrir la ventana: profe actual, profe de la prueba y lista de profes. */
export async function getAssignTeacherOptions(studentId: string): Promise<AssignTeacherOptions | null> {
  const sb = supabaseAdmin();
  const s = await loadStudent(studentId);
  if (!s) return null;
  const [current, trial] = await Promise.all([
    loadCurrentTeacher(studentId),
    s.trial_teacher_id ? loadTeacher(s.trial_teacher_id) : Promise.resolve(null),
  ]);
  const { data: ts } = await sb.from("teachers").select("id, users!inner(full_name, email, active)").eq("active", true).eq("users.active", true);
  const { data: groups } = await sb.from("student_group_members")
    .select("student_groups!inner(teacher_id, active), students!inner(subscription_status, users!inner(active))")
    .eq("student_groups.active", true).eq("students.users.active", true).in("students.subscription_status", ["active", "paused"]);
  const counts = new Map<string, number>();
  for (const r of (groups ?? []) as Array<{ student_groups: unknown }>) {
    const g = firstOf(r.student_groups as { teacher_id: string } | Array<{ teacher_id: string }>);
    if (g?.teacher_id) counts.set(g.teacher_id, (counts.get(g.teacher_id) ?? 0) + 1);
  }
  const teachers = ((ts ?? []) as Array<{ id: string; users: unknown }>).map(t => {
    const u = firstOf(t.users as { full_name: string | null; email: string } | Array<{ full_name: string | null; email: string }>)!;
    return { id: t.id, fullName: u.full_name ?? u.email, activeStudents: counts.get(t.id) ?? 0 };
  }).sort((a, b) => a.fullName.localeCompare(b.fullName));
  return {
    student: { id: s.id, fullName: s.u.full_name ?? s.u.email, neverLoggedIn: !s.u.last_login_at, hasPhone: !!s.u.phone, active: s.u.active },
    currentTeacher: current ? { teacherId: current.teacherId, fullName: current.fullName } : null,
    trialTeacher: trial ? { teacherId: trial.teacherId, fullName: trial.fullName } : null,
    teachers,
  };
}

type Plan = {
  studentUserId: string;
  newTeacher: TeacherRef;
  oldTeacher: TeacherRef | null;
  trialTeacher: TeacherRef | null;
  notices: AssignmentNotices;
  academyId: string;
  studentChat: { chatId: string | null; toDelete: string[]; welcomeFix: { id: string; content: string } | null };
};

async function buildPlan(args: { studentId: string; newTeacherId: string; note?: string | null; includePhone?: boolean }): Promise<{ ok: true; plan: Plan } | { ok: false; error: string }> {
  const sb = supabaseAdmin();
  const s = await loadStudent(args.studentId);
  if (!s) return { ok: false, error: "Estudiante no encontrado." };
  const academyId = await academyUserId();
  if (!academyId) return { ok: false, error: "No encuentro la cuenta de la academia para enviar los avisos." };
  const newT = await loadTeacher(args.newTeacherId);
  if (!newT) return { ok: false, error: "Profesor no encontrado." };
  const oldT = await loadCurrentTeacher(args.studentId);
  if (oldT && oldT.teacherId === newT.teacherId) return { ok: false, error: `${s.u.full_name ?? "El estudiante"} ya está con ${newT.fullName}.` };

  // Profe de la prueba: solo si no es el nuevo ni el anterior, y nunca la
  // propia cuenta de la academia (cuando Gelfis dio la prueba).
  let trialT: (TeacherRef & { email: string }) | null = s.trial_teacher_id ? await loadTeacher(s.trial_teacher_id) : null;
  if (trialT && (trialT.teacherId === newT.teacherId || trialT.teacherId === oldT?.teacherId || trialT.userId === academyId)) trialT = null;

  const goal = goalLevelEs(s.goal);
  const goalLabel = /^(A2|B1|B2|C1)$/.test(goal) ? goal : null;   // metas sin nivel claro no se inventan
  const ritmo = ritmoLabelEs({ subscription_type: s.subscription_type as never, classes_per_month: s.classes_per_month, monthly_price_cents: s.monthly_price_cents });
  const planLabel = s.subscription_type === "monthly_subscription" && s.classes_per_month
    ? `${ritmo} (${s.classes_per_month} clases al mes)` : ritmo;

  const notices = renderAssignmentNotices({
    student: {
      fullName: s.u.full_name ?? s.u.email, level: s.current_level, goalLabel, planLabel,
      neverLoggedIn: !s.u.last_login_at, phone: s.u.phone, lang: s.u.language_preference ?? "es",
    },
    newTeacher: { fullName: newT.fullName },
    oldTeacher: oldT ? { fullName: oldT.fullName, hasCommission: await hasCommission(args.studentId, oldT.userId) } : null,
    trialTeacher: trialT ? { fullName: trialT.fullName, hasCommission: await hasCommission(args.studentId, trialT.userId) } : null,
    note: args.note ?? null,
    includePhone: args.includePhone !== false,
  });

  // Chat alumno–academia: qué avisos viejos sin leer se retiran y si la
  // bienvenida (también sin leer) necesita el nombre del profe nuevo.
  const studentChat: Plan["studentChat"] = { chatId: null, toDelete: [], welcomeFix: null };
  const { data: mine } = await sb.from("chat_participants").select("chat_id, last_read_at, chats!inner(type)").eq("user_id", s.user_id).eq("chats.type", "direct");
  const { data: shared } = await sb.from("chat_participants").select("chat_id").eq("user_id", academyId).in("chat_id", ((mine ?? []) as Array<{ chat_id: string }>).map(x => x.chat_id));
  const chatId = (shared as Array<{ chat_id: string }> | null)?.[0]?.chat_id ?? null;
  if (chatId) {
    studentChat.chatId = chatId;
    const lastRead = ((mine ?? []) as Array<{ chat_id: string; last_read_at: string | null }>).find(x => x.chat_id === chatId)?.last_read_at ?? null;
    const { data: msgs } = await sb.from("messages").select("id, content, sent_at").eq("chat_id", chatId).eq("author_id", academyId).eq("deleted", false).order("sent_at");
    for (const m of (msgs ?? []) as Array<{ id: string; content: string; sent_at: string }>) {
      const unread = !lastRead || new Date(m.sent_at).getTime() > new Date(lastRead).getTime();
      if (!unread) continue;
      if (isAssignmentNoticeToStudent(m.content)) { studentChat.toDelete.push(m.id); continue; }
      const fixed = fixWelcomeTeacherName(m.content, newT.fullName);
      if (fixed && !studentChat.welcomeFix) studentChat.welcomeFix = { id: m.id, content: fixed };
    }
  }

  return {
    ok: true,
    plan: {
      studentUserId: s.user_id, academyId, notices, studentChat,
      newTeacher: { teacherId: newT.teacherId, userId: newT.userId, fullName: newT.fullName },
      oldTeacher: oldT,
      trialTeacher: trialT ? { teacherId: trialT.teacherId, userId: trialT.userId, fullName: trialT.fullName } : null,
    },
  };
}

/** Vista previa: los mensajes exactos y la limpieza que se haría. No cambia nada. */
export async function previewAssignTeacher(args: { studentId: string; newTeacherId: string; note?: string | null; includePhone?: boolean }): Promise<{ ok: true; preview: AssignPreview } | { ok: false; error: string }> {
  const b = await buildPlan(args);
  if (!b.ok) return b;
  const p = b.plan;
  const { data: su } = await supabaseAdmin().from("users").select("full_name, email").eq("id", p.studentUserId).maybeSingle();
  return {
    ok: true,
    preview: {
      notices: p.notices,
      recipients: {
        student: (su as { full_name: string | null; email: string } | null)?.full_name ?? "Estudiante",
        newTeacher: p.newTeacher.fullName,
        oldTeacher: p.oldTeacher?.fullName ?? null,
        trialTeacher: p.trialTeacher?.fullName ?? null,
      },
      cleanup: { unreadNoticesToDelete: p.studentChat.toDelete.length, welcomeWillBeFixed: !!p.studentChat.welcomeFix },
    },
  };
}

export type AssignTeacherResult =
  | { ok: false; error: string }
  | { ok: true; newTeacher: string; sent: AssignNotify; cleanup: { deleted: number; welcomeFixed: boolean }; warnings: string[] };

/** Asigna el profe y envía los avisos marcados. */
export async function assignTeacherWithNotices(args: {
  studentId: string; newTeacherId: string; actorUserId: string;
  note?: string | null; includePhone?: boolean; notify?: Partial<AssignNotify>;
}): Promise<AssignTeacherResult> {
  const sb = supabaseAdmin();
  const b = await buildPlan(args);
  if (!b.ok) return b;
  const p = b.plan;
  const notify: AssignNotify = { student: true, newTeacher: true, oldTeacher: true, trialTeacher: true, ...(args.notify ?? {}) };

  const r = await reassignTeacher({
    studentId: args.studentId, newTeacherId: args.newTeacherId,
    reason: (args.note ?? "").trim() || "Asignado desde la ficha del estudiante",
    reassignedByUserId: args.actorUserId,
  });
  if (!r.ok) return { ok: false, error: r.error === "same_teacher" ? "Ya está con ese profe." : `No se pudo asignar: ${r.error}` };

  const warnings: string[] = [];
  const sent: AssignNotify = { student: false, newTeacher: false, oldTeacher: false, trialTeacher: false };
  const send = async (key: keyof AssignNotify, toUserId: string | undefined, content: string | null) => {
    if (!notify[key] || !toUserId || !content) return;
    if (toUserId === p.academyId) return;                       // la academia no se escribe a sí misma
    try {
      const chatId = await ensureDirectChat(p.academyId, toUserId);
      const m = await sendMessage({ chatId, authorId: p.academyId, content });
      if (m) sent[key] = true; else warnings.push(`No se pudo enviar el aviso (${key}).`);
    } catch (e) {
      warnings.push(`Aviso (${key}) falló: ${e instanceof Error ? e.message : "error"}`);
    }
  };

  // Limpieza del chat del alumno ANTES de escribirle: solo mensajes que no
  // ha leído. Los avisos viejos se retiran únicamente si va a recibir el
  // nuevo; el nombre del profe en la bienvenida se corrige siempre.
  const cleanup = { deleted: 0, welcomeFixed: false };
  try {
    if (notify.student && p.studentChat.toDelete.length > 0) {
      const { count, error } = await sb.from("messages").delete({ count: "exact" }).in("id", p.studentChat.toDelete);
      if (error) warnings.push(`No se pudieron retirar avisos anteriores: ${error.message}`); else cleanup.deleted = count ?? 0;
    }
    if (p.studentChat.welcomeFix) {
      const { error } = await sb.from("messages").update({ content: p.studentChat.welcomeFix.content }).eq("id", p.studentChat.welcomeFix.id);
      if (error) warnings.push(`No se pudo corregir la bienvenida: ${error.message}`); else cleanup.welcomeFixed = true;
    }
  } catch (e) {
    warnings.push(`Limpieza del chat falló: ${e instanceof Error ? e.message : "error"}`);
  }

  await send("newTeacher", p.newTeacher.userId, p.notices.toNewTeacher);
  await send("oldTeacher", p.oldTeacher?.userId, p.notices.toOldTeacher);
  await send("trialTeacher", p.trialTeacher?.userId, p.notices.toTrialTeacher);
  await send("student", p.studentUserId, p.notices.toStudent);

  return { ok: true, newTeacher: p.newTeacher.fullName, sent, cleanup, warnings };
}
