import { supabaseAdmin } from "@/lib/supabase";
import { ensureDirectChat, sendMessage } from "@/lib/chat";
import { ritmoLabelEs, goalLevelEs } from "@/lib/academy";

/**
 * Mensaje de bienvenida por el chat de la plataforma, de parte de Gelfis,
 * a cada alumno nuevo que convierte (Gelfis 2026-10-16). Se envía al
 * final del flujo post-conversión (ya con profesor asignado). Idempotente:
 * si Gelfis ya escribió en ese chat, no se repite.
 */
const ACADEMY_CHAT_EMAIL = process.env.ACADEMY_CHAT_EMAIL ?? "aprenderaleman2026@gmail.com";

type Ctx = {
  name: string; level: string; goal: string; ritmo: string; perMonth: number | null;
  teacher: string | null; bono: boolean; lang: "es" | "de";
};

export function renderWelcomeChat(c: Ctx): string {
  // Nombre de pila: nombres compuestos cortos ("Maria Elena") se respetan.
  const parts = c.name.trim().split(/\s+/);
  const first = parts.length <= 2 ? parts.join(" ") : parts[0];
  const plan = c.perMonth ? `${c.ritmo} (${c.perMonth} clases al mes)` : c.ritmo;
  if (c.lang === "de") {
    return [
      `Hallo ${first}! Ich bin Gelfis, Leiter von Aprender-Aleman.de. Herzlich willkommen in der Akademie 🎉`,
      `Dein Plan: ${plan}, von ${c.level} bis ${c.goal}.${c.teacher ? ` Dein Lehrer/deine Lehrerin ist ${c.teacher} und schreibt dir hier, um eure Termine festzulegen.` : ` Wir weisen dir gerade deinen Lehrer zu; er/sie meldet sich hier bei dir.`}`,
      c.bono ? `🎁 Da du dich direkt nach deiner Probestunde angemeldet hast, bekommst du zusätzlich eine kostenlose Konversationsstunde. Dein Lehrer plant sie mit dir ein.` : "",
      `Dieser Chat ist direkt mit mir: bei Fragen zu Zahlungen, Terminen oder deinem Plan schreib mir hier, ich antworte dir persönlich. Auf geht's! 💪`,
    ].filter(Boolean).join("\n\n");
  }
  return [
    `¡Hola ${first}! Soy Gelfis, director de Aprender-Aleman.de. Bienvenido/a a la academia 🎉`,
    `Tu plan: ${plan}, de ${c.level} a ${c.goal}.${c.teacher ? ` Tu profesor/a es ${c.teacher}, que te escribirá por aquí para fijar tus horarios.` : ` Te estamos asignando profesor/a; te escribirá por aquí en breve.`}`,
    c.bono ? `🎁 Como te inscribiste justo después de tu clase de prueba, tienes además una clase de conversación gratis. Tu profesor/a la agendará contigo.` : "",
    `Este chat es directo conmigo: para cualquier duda sobre pagos, horarios o tu plan, escríbeme aquí y te respondo personalmente. ¡Vamos a por ese alemán! 💪`,
  ].filter(Boolean).join("\n\n");
}

export async function buildWelcomeChatForStudent(studentId: string): Promise<{ text: string; studentUserId: string } | null> {
  const sb = supabaseAdmin();
  const { data } = await sb.from("students")
    .select("id, user_id, current_level, goal, subscription_type, classes_per_month, monthly_price_cents, bono_conversacion_at, trial_teacher_id, users!inner(full_name, email, language_preference)")
    .eq("id", studentId).maybeSingle();
  if (!data) return null;
  const s = data as {
    user_id: string; current_level: string; goal: string | null; subscription_type: string; classes_per_month: number | null;
    monthly_price_cents: number | null; bono_conversacion_at: string | null; trial_teacher_id: string | null; users: unknown;
  };
  const u = (Array.isArray(s.users) ? s.users[0] : s.users) as { full_name: string | null; email: string; language_preference: "es" | "de" | null };

  // Profesor: grupo activo del alumno; si no, el de la clase de prueba.
  let teacher: string | null = null;
  const { data: g } = await sb.from("student_group_members")
    .select("student_groups!inner(active, teachers!inner(users!inner(full_name)))").eq("student_id", studentId).eq("student_groups.active", true).limit(1);
  const first = <T,>(v: T | T[] | null | undefined): T | undefined => (Array.isArray(v) ? v[0] : v ?? undefined);
  const gr = first((g ?? [])[0] as { student_groups: unknown } | undefined ? ((g ?? [])[0] as { student_groups: unknown }).student_groups as { teachers: unknown } | { teachers: unknown }[] : null);
  const tu = first(first(gr?.teachers as { users: unknown } | { users: unknown }[])?.users as { full_name: string } | { full_name: string }[]);
  teacher = tu?.full_name ?? null;
  if (!teacher && s.trial_teacher_id) {
    const { data: t } = await sb.from("teachers").select("users!inner(full_name)").eq("id", s.trial_teacher_id).maybeSingle();
    teacher = (first((t as { users: unknown } | null)?.users as { full_name: string } | { full_name: string }[]))?.full_name ?? null;
  }

  const text = renderWelcomeChat({
    name: u.full_name ?? u.email, level: s.current_level, goal: goalLevelEs(s.goal),
    ritmo: ritmoLabelEs({ subscription_type: s.subscription_type as never, classes_per_month: s.classes_per_month, monthly_price_cents: s.monthly_price_cents }),
    perMonth: s.subscription_type === "monthly_subscription" ? s.classes_per_month : null,
    teacher, bono: !!s.bono_conversacion_at, lang: u.language_preference ?? "es",
  });
  return { text, studentUserId: s.user_id };
}

export async function sendAcademyWelcomeChat(studentId: string): Promise<{ ok: boolean; reason?: string }> {
  const sb = supabaseAdmin();
  const { data: admin } = await sb.from("users").select("id").eq("email", ACADEMY_CHAT_EMAIL).maybeSingle();
  const adminId = (admin as { id: string } | null)?.id;
  if (!adminId) return { ok: false, reason: "academy_user_not_found" };
  const built = await buildWelcomeChatForStudent(studentId);
  if (!built) return { ok: false, reason: "student_not_found" };
  const chatId = await ensureDirectChat(adminId, built.studentUserId);
  const { data: prev } = await sb.from("messages").select("id").eq("chat_id", chatId).eq("author_id", adminId).eq("deleted", false).limit(1);
  if ((prev ?? []).length > 0) return { ok: true, reason: "already_sent" };
  const m = await sendMessage({ chatId, authorId: adminId, content: built.text });
  return m ? { ok: true } : { ok: false, reason: "send_failed" };
}
