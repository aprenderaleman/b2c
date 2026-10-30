import { supabaseAdmin } from "./supabase";
import { ensureDirectChat, sendMessage } from "./chat";
import { createNotification } from "./notifications";
import { createAdminNotification } from "./admin-notifications";
import { sendRaw } from "./email/send";
import { renderStudentInactivity, type InactivityKind } from "./email/templates/student-inactivity";
import { ACADEMY_CHAT_EMAIL } from "./chat-display";

/**
 * Reactivación automática de alumnos sin clases (Gelfis 2026-10-30).
 *
 * Cada lunes (cron /api/cron/student-inactivity) revisa los alumnos con
 * suscripción activa, sin ninguna clase futura agendada y con clases
 * disponibles (o plan mensual):
 *   - never_started_7: convirtió hace >= 7 días y nunca tuvo clase.
 *   - inactive_14:     >= 14 días desde su última clase completada.
 *   - inactive_30:     >= 30 días (último aviso; después, solo humanos).
 * Un email por umbral y por racha (tabla student_inactivity_emails,
 * migración 149; la racha se identifica por last_class_at). Las clases
 * canceladas no cuentan como actividad; las de prueba tampoco.
 *
 * Por cada email: aviso al profe asignado (mensaje por chat desde la
 * cuenta de la academia, que a su vez le llega por email) + campana, y
 * notificación admin para Gelfis.
 */
export type { InactivityKind };

const PLATFORM_URL = (process.env.NEXT_PUBLIC_PLATFORM_URL || process.env.PLATFORM_URL || "https://b2c.aprender-aleman.de").replace(/\/$/, "");
const DAY = 86_400_000;

export type InactivityInput = {
  createdAt:       Date;
  lastCompletedAt: Date | null;
  hasFutureClass:  boolean;
  remaining:       number | null;
  subscriptionType: string | null;
  now?:            Date;
};

/** Regla pura (testeable): qué aviso toca hoy, o null. */
export function classifyInactivity(i: InactivityInput): InactivityKind | null {
  const now = i.now ?? new Date();
  if (i.hasFutureClass) return null;
  const hasCredit = (i.remaining ?? 0) > 0 || i.subscriptionType === "monthly_subscription";
  if (!hasCredit) return null;
  if (!i.lastCompletedAt) {
    return now.getTime() - i.createdAt.getTime() >= 7 * DAY ? "never_started_7" : null;
  }
  const days = Math.floor((now.getTime() - i.lastCompletedAt.getTime()) / DAY);
  if (days >= 30) return "inactive_30";
  if (days >= 14) return "inactive_14";
  return null;
}

function firstName(full: string | null, email: string): string {
  const parts = (full ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return email.split("@")[0];
  return parts.length <= 2 ? parts.join(" ") : parts[0];
}

function daysLabel(kind: InactivityKind): string {
  return kind === "never_started_7" ? "7 días sin su primera clase" : kind === "inactive_14" ? "14 días sin clase" : "30 días sin clase";
}

export type InactivityCandidate = {
  studentId: string; userId: string; name: string; email: string; lang: "es" | "de";
  kind: InactivityKind; lastCompletedAt: Date | null; remaining: number | null;
  teacher: { userId: string; name: string } | null;
};

/** Lista los alumnos a los que hoy les tocaría un aviso (sin enviar nada). */
export async function findInactivityCandidates(now = new Date()): Promise<InactivityCandidate[]> {
  const sb = supabaseAdmin();
  const { data: students } = await sb.from("students")
    .select("id, user_id, created_at, classes_remaining, subscription_type, subscription_status, users!inner(full_name, email, active, role, language_preference)")
    .eq("subscription_status", "active");
  const out: InactivityCandidate[] = [];
  for (const raw of (students ?? []) as Array<{ id: string; user_id: string; created_at: string; classes_remaining: number | null; subscription_type: string | null; users: unknown }>) {
    const u = (Array.isArray(raw.users) ? raw.users[0] : raw.users) as { full_name: string | null; email: string; active: boolean; role: string; language_preference: "es" | "de" | null };
    if (!u?.active || u.role !== "student") continue;

    const { data: parts } = await sb.from("class_participants")
      .select("class:classes!inner(status, scheduled_at, is_trial)")
      .eq("student_id", raw.id);
    let lastCompletedAt: Date | null = null; let hasFutureClass = false;
    for (const p of (parts ?? []) as Array<{ class: unknown }>) {
      const c = (Array.isArray(p.class) ? p.class[0] : p.class) as { status: string; scheduled_at: string; is_trial: boolean } | undefined;
      if (!c) continue;
      const at = new Date(c.scheduled_at);
      if (c.status === "scheduled" && at > now) hasFutureClass = true;
      if (c.status === "completed" && !c.is_trial && (!lastCompletedAt || at > lastCompletedAt)) lastCompletedAt = at;
    }

    const kind = classifyInactivity({ createdAt: new Date(raw.created_at), lastCompletedAt, hasFutureClass, remaining: raw.classes_remaining, subscriptionType: raw.subscription_type, now });
    if (!kind) continue;

    // Dedupe: mismo umbral y misma racha ya avisado.
    const { data: prev, error: prevErr } = await sb.from("student_inactivity_emails").select("last_class_at").eq("student_id", raw.id).eq("kind", kind);
    // Sin tabla (migración 149 pendiente) no enviamos nada: fail-closed.
    if (prevErr) { console.warn("[inactivity] dedupe no disponible:", prevErr.message); continue; }
    const key = lastCompletedAt ? lastCompletedAt.toISOString() : null;
    if ((prev ?? []).some(r => ((r as { last_class_at: string | null }).last_class_at ? new Date((r as { last_class_at: string }).last_class_at).toISOString() : null) === key)) continue;

    // Profe: grupo activo del alumno (individual primero; si no, el grupal,
    // p. ej. Gastón y Annette comparten grupo con Simon).
    let teacher: InactivityCandidate["teacher"] = null;
    const { data: g } = await sb.from("student_group_members")
      .select("student_groups!inner(active, class_type, teachers!inner(user_id, users!inner(full_name, email)))")
      .eq("student_id", raw.id).eq("student_groups.active", true);
    const pick = <T,>(v: T | T[] | null | undefined): T | undefined => (Array.isArray(v) ? v[0] : v ?? undefined);
    type SG = { class_type: string; teachers: unknown };
    const sgs = ((g ?? []) as Array<{ student_groups: SG | SG[] }>).map(x => pick(x.student_groups)).filter((x): x is SG => !!x);
    const sg = sgs.find(x => x.class_type === "individual") ?? sgs[0];
    const t = pick(sg?.teachers as { user_id: string; users: unknown } | { user_id: string; users: unknown }[]);
    const tu = pick(t?.users as { full_name: string | null; email: string } | { full_name: string | null; email: string }[]);
    if (t && tu && tu.email.toLowerCase() !== ACADEMY_CHAT_EMAIL.toLowerCase()) teacher = { userId: t.user_id, name: tu.full_name ?? "Profesor/a" };

    out.push({ studentId: raw.id, userId: raw.user_id, name: firstName(u.full_name, u.email), email: u.email, lang: u.language_preference ?? "es", kind, lastCompletedAt, remaining: raw.classes_remaining, teacher });
  }
  return out;
}

/** Envía los avisos del día. Devuelve cuántos emails salieron. */
export async function runStudentInactivity(opts: { dryRun?: boolean } = {}): Promise<{ sent: number; candidates: InactivityCandidate[] }> {
  const sb = supabaseAdmin();
  const candidates = await findInactivityCandidates();
  if (opts.dryRun) return { sent: 0, candidates };

  const { data: academy } = await sb.from("users").select("id").eq("email", ACADEMY_CHAT_EMAIL).maybeSingle();
  const academyId = (academy as { id: string } | null)?.id ?? null;
  let sent = 0;

  for (const c of candidates) {
    try {
      const chatId = academyId ? await ensureDirectChat(academyId, c.userId) : null;
      const chatUrl = chatId ? `${PLATFORM_URL}/estudiante/chats?chat=${chatId}` : `${PLATFORM_URL}/estudiante/chats`;
      const { subject, html, text } = renderStudentInactivity({ kind: c.kind, name: c.name, teacherName: c.teacher?.name ?? null, remaining: c.remaining, chatUrl, language: c.lang });
      const r = await sendRaw(c.email, subject, html, text);
      if (!r.ok) { console.warn(`[inactivity] email fallido ${c.email}: ${r.error}`); continue; }
      sent++;
      await sb.from("student_inactivity_emails").insert({ student_id: c.studentId, kind: c.kind, last_class_at: c.lastCompletedAt?.toISOString() ?? null });

      const label = daysLabel(c.kind);
      const left = c.remaining && c.remaining > 0 ? ` Le quedan ${c.remaining} clases.` : "";
      // Profe: chat desde la academia (le llega también por email) + campana.
      if (c.teacher && academyId) {
        const tChat = await ensureDirectChat(academyId, c.teacher.userId);
        await sendMessage({ chatId: tChat, authorId: academyId, content: `Aviso automático: le escribí a ${c.name} por llevar ${label} y no tener ninguna agendada.${left} Si sabes algo o puedes contactarle, cuéntamelo por aquí.` });
        await createNotification({ user_id: c.teacher.userId, type: "generic", title: `${c.name} — ${label}`, body: `Le enviamos un email de reactivación.${left}`, link: "/profesor/estudiantes" });
      }
      await createAdminNotification({ type: "student_inactivity", severity: "info", title: `Reactivación: ${c.name} (${label})`, body: `Email enviado a ${c.email}.${left}${c.teacher ? ` Profe avisado: ${c.teacher.name}.` : " Sin profe asignado."}`, action_url: `/admin/estudiantes/${c.studentId}`, dedupeHours: false });
    } catch (e) {
      console.error("[inactivity] fallo con", c.email, e instanceof Error ? e.message : e);
    }
  }
  return { sent, candidates };
}
