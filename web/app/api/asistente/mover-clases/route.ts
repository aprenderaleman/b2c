import { NextResponse, after } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { getTeacherByUserId } from "@/lib/academy";
import { createNotification } from "@/lib/notifications";
import { sendClassLifecycleEmail, lifecycleEmailsEnabled } from "@/lib/email/send";
import { syncTeacherCalendarAfterReschedule } from "@/lib/teacher-calendar-sync";
import { resolveStudentTeacher } from "@/lib/student-schedule";
import { planMover, aplicarMover, MAX_MOVER, type Actor, type Movimiento } from "@/lib/asistente/mover";

/**
 * POST /api/asistente/mover-clases  { classIds, hora, desplazarDias? }
 *
 * Mueve varias clases con UNA confirmación y UN aviso por persona. Mismos
 * avisos que el movimiento manual: profe → email + campana al alumno;
 * alumno → campana al profe; admin → ninguno. Todo se revalida aquí.
 */

export const runtime = "nodejs";
export const maxDuration = 60;

const PLATFORM_URL = (process.env.PLATFORM_URL ?? "https://b2c.aprender-aleman.de").replace(/\/$/, "");

const Body = z.object({
  classIds:      z.array(z.string().uuid()).min(1).max(MAX_MOVER),
  hora:          z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  desplazarDias: z.number().int().min(-6).max(6).optional(),
});

async function resolveActor(): Promise<{ actor: Actor; name: string } | NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const role   = (session.user as { role?: string }).role;
  const userId = (session.user as { id: string }).id;
  const name   = session.user.name ?? session.user.email ?? "";
  if (role === "admin" || role === "superadmin") return { actor: { role: "admin" }, name };
  if (role === "teacher") {
    const me = await getTeacherByUserId(userId);
    if (!me) return NextResponse.json({ error: "no_teacher_profile" }, { status: 403 });
    return { actor: { role: "teacher", teacherId: me.id }, name };
  }
  if (role === "student") {
    const { data } = await supabaseAdmin().from("students").select("id").eq("user_id", userId).maybeSingle();
    if (!data) return NextResponse.json({ error: "no_student_profile" }, { status: 403 });
    return { actor: { role: "student", studentId: (data as { id: string }).id }, name };
  }
  return NextResponse.json({ error: "forbidden" }, { status: 403 });
}

export async function POST(req: Request) {
  const who = await resolveActor();
  if (who instanceof NextResponse) return who;

  let raw: unknown;
  try { raw = await req.json(); }
  catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed", details: parsed.error.flatten() }, { status: 400 });
  }

  const plan = await planMover(who.actor, parsed.data);
  if (!plan.ok) return NextResponse.json({ error: "not_allowed", message: plan.motivo }, { status: 409 });

  try {
    await aplicarMover(plan.moves);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    if (/no_double_booking|duplicate key/i.test(msg)) {
      return NextResponse.json({ error: "double_booking", message: "Algún horario acaba de ocuparse. No se ha cambiado nada." }, { status: 409 });
    }
    return NextResponse.json({ error: "update_failed", message: "No se pudo completar. No se ha cambiado nada." }, { status: 500 });
  }

  const ids = plan.moves.map(m => m.id);
  const actor = who.actor;
  after(() => Promise.allSettled([
    syncTeacherCalendarAfterReschedule(ids),
    avisar(actor, who.name, plan.moves),
  ]));

  return NextResponse.json({ ok: true, moved: ids.length });
}

async function avisar(actor: Actor, name: string, moves: Movimiento[]): Promise<void> {
  if (actor.role === "admin") return;
  const first = moves[0];
  const fmt = (lang: "es" | "de") => new Date(first.to).toLocaleString(lang === "de" ? "de-DE" : "es-ES", {
    weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin",
  });

  if (actor.role === "student") {
    const teacher = await resolveStudentTeacher(actor.studentId);
    if (!teacher) return;
    await createNotification({
      user_id:  teacher.teacherUserId,
      type:     "class_updated",
      title:    `${name} movió ${moves.length} ${moves.length === 1 ? "clase" : "clases"}`,
      body:     `La primera queda el ${fmt("es")} (Berlín).`,
      link:     `/profesor/clases/${first.id}`,
      class_id: first.id,
    });
    return;
  }

  const sb = supabaseAdmin();
  const studentIds = [...new Set(moves.flatMap(m => m.students))];
  const { data } = await sb
    .from("students")
    .select("id, user_id, users!inner(email, full_name, language_preference)")
    .in("id", studentIds);
  for (const s of (data ?? []) as Array<{ id: string; user_id: string; users: unknown }>) {
    const u = (Array.isArray(s.users) ? s.users[0] : s.users) as
      { email: string; full_name: string | null; language_preference: "es" | "de" } | undefined;
    if (!u) continue;
    const mine = moves.filter(m => m.students.includes(s.id));
    const lang = u.language_preference;
    if (lifecycleEmailsEnabled() && u.email) {
      await sendClassLifecycleEmail(u.email, {
        audience:      "student",
        kind:          "rescheduled",
        recipientName: (u.full_name ?? "").trim().split(/\s+/)[0] || u.email,
        classTitle:    mine[0].title + (mine.length > 1 ? ` (${mine.length} clases)` : ""),
        startDate:     fmt(lang) + (lang === "de" ? " (Berlin)" : " (Berlín)"),
        durationMin:   mine[0].duration,
        count:         mine.length,
        classUrl:      `${PLATFORM_URL}/estudiante/clases/${mine[0].id}`,
        language:      lang,
      }).catch(e => console.error("[asistente/mover] email failed:", e));
    }
    await createNotification({
      user_id:  s.user_id,
      type:     "class_updated",
      title:    mine.length > 1 ? `${mine.length} clases reprogramadas` : "Clase reprogramada",
      body:     `${mine[0].title} — la primera queda el ${fmt(lang)}`,
      link:     `/estudiante/clases/${mine[0].id}`,
      class_id: mine[0].id,
    });
  }
}
