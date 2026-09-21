import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { createNotification, isNotificationsOptOut } from "@/lib/notifications";
import { sendPackMilestoneEmail } from "@/lib/email/send";
import { sendWhatsappText } from "@/lib/whatsapp";
import { getActiveTemplate, renderTemplate } from "@/lib/message-stats";
import { goalLevelEs } from "@/lib/academy";
import { deactivateStudent } from "@/lib/student-deactivate";
import { removeTeacherCalendarEvents } from "@/lib/teacher-calendar-sync";

/**
 * GET /api/cron/pack-alerts — cada hora en punto (vercel.json), pero solo
 * ACTÚA a las 08:00 hora Berlín (Gelfis 2026-09-21), con o sin cambio de
 * hora. `?force=1` salta esa ventana (pruebas / envío manual).
 *
 * Hitos de clases restantes (Gelfis 2026-09-21), firmados por Stiv, por
 * email + WhatsApp + campana:
 *   ≤10 → "Estás llegando a la meta, ¡sigue así!"
 *   ≤5  → "Solo 5 sesiones más, casi lo tienes…"
 *   =0  → "¡Felicidades, lo has logrado!" y BAJA automática del alumno
 *         (users.active=false, subscription_status='expired', clases
 *         futuras canceladas, profe avisado).
 *
 * Se usa "≤" y no "=" porque una clase de 2 unidades puede saltar un
 * valor exacto. Cada hito se envía una sola vez por alumno
 * (student_milestones); si un alumno salta de 12 a 4, recibe solo el de 5.
 *
 * Textos editables en /admin/mensajes (kind pack_milestone, sub_n 10/5/0,
 * canal whatsapp / email). El email usa "asunto|||cuerpo".
 */

export const runtime = "nodejs";
export const maxDuration = 60;

const WHATSAPP_URL = "https://wa.me/4917684930450";
const MILESTONES = [10, 5, 0] as const;
type Milestone = typeof MILESTONES[number];

const FALLBACK_WA: Record<Milestone, string> = {
  10: "¡{nombre}! 🎯 Ya solo te quedan 10 clases para llegar a tu meta {meta}.\nEstás llegando a la meta — ¡sigue así!\n— Stiv · Aprender-Aleman.de",
  5:  "¡{nombre}! Solo 5 sesiones más y lo tienes 💪 ¿Listo/a para continuar con el siguiente nivel? Respóndeme aquí.\n— Stiv · Aprender-Aleman.de",
  0:  "¡FELICIDADES, {nombre}! 🎉 Lo has logrado: has completado tus {total} clases y llegado a tu meta {meta}. ¿Seguimos con el siguiente nivel?\n— Stiv · Aprender-Aleman.de",
};
const FALLBACK_EMAIL: Record<Milestone, string> = {
  10: "Estás llegando a la meta, ¡sigue así!|||Ya solo te quedan 10 clases para llegar a tu meta {meta}. ¡Sigue así!",
  5:  "Solo 5 sesiones más, casi lo tienes|||Solo 5 sesiones más y lo tienes. ¿Listo/a para continuar con el siguiente nivel?",
  0:  "¡Felicidades, lo has logrado! 🎉|||Has completado tus {total} clases y has llegado a tu meta {meta}. ¿Seguimos con el siguiente nivel?",
};

function authorisedCronRequest(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const bearer = req.headers.get("authorization");
  if (bearer && bearer.toLowerCase().startsWith("bearer ")) {
    if (bearer.slice(7).trim() === expected) return true;
  }
  return req.headers.get("x-cron-secret") === expected;
}

export async function GET(req: Request) { return run(req); }
export async function POST(req: Request) { return run(req); }

/** Hito que corresponde al saldo actual, o null si está por encima de 10. */
function milestoneFor(remaining: number): Milestone | null {
  if (remaining <= 0) return 0;
  if (remaining <= 5) return 5;
  if (remaining <= 10) return 10;
  return null;
}

async function run(req: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "cron_not_configured" }, { status: 503 });
  }
  if (!authorisedCronRequest(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const force = new URL(req.url).searchParams.get("force") === "1";
  const berlinHour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", hour: "2-digit", hour12: false }).format(new Date()));
  if (!force && berlinHour !== 8) {
    return NextResponse.json({ ok: true, skipped: true, reason: `fuera de ventana (Berlín ${berlinHour}h, se envía a las 8h)` });
  }

  const sb = supabaseAdmin();
  const details: Array<Record<string, unknown>> = [];

  const SELECT = "id, user_id, goal, clases_totales, classes_remaining, subscription_status, users!inner(full_name, email, phone, active)";
  // Alumnos activos con contrato y saldo ≤ 10…
  const { data: active } = await sb
    .from("students")
    .select(SELECT)
    .lte("classes_remaining", 10)
    .gt("clases_totales", 0)
    .eq("users.active", true);
  // …y los que ya se dieron de baja por agotar el pack (expired) sin haber
  // recibido aún el mensaje de meta cumplida (p. ej. baja hecha a mano).
  const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const { data: expired } = await sb
    .from("students")
    .select(SELECT)
    .eq("classes_remaining", 0)
    .gt("clases_totales", 0)
    .eq("subscription_status", "expired")
    .eq("users.active", false)
    .gte("updated_at", since);

  const seen = new Set<string>();
  const students = [...(active ?? []), ...(expired ?? [])].filter(r => {
    const id = (r as Record<string, unknown>).id as string;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  for (const raw of students as Array<Record<string, unknown>>) {
    const uRaw = raw.users as Record<string, unknown> | Record<string, unknown>[];
    const u = Array.isArray(uRaw) ? uRaw[0] : uRaw;
    const studentId = raw.id as string;
    const userId = raw.user_id as string;
    const remaining = Number(raw.classes_remaining ?? 0);
    const total = Number(raw.clases_totales ?? 0);
    const fullName = (u.full_name as string | null) ?? "Estudiante";
    const email = u.email as string;
    const phone = (u.phone as string | null) ?? null;

    const milestone = milestoneFor(remaining);
    if (milestone === null) continue;

    const { data: already } = await sb
      .from("student_milestones")
      .select("id")
      .eq("student_id", studentId)
      .eq("milestone", milestone)
      .maybeSingle();
    if (already) continue;

    const vars = {
      nombre:    fullName.split(/\s+/)[0],
      meta:      goalLevelEs((raw.goal as string | null) ?? null),
      total:     String(total),
      restantes: String(remaining),
    };
    const optOut = await isNotificationsOptOut(userId);

    // WhatsApp
    let waOk = false;
    if (!optOut && phone) {
      const tpl = await getActiveTemplate("pack_milestone", "whatsapp", milestone);
      const text = renderTemplate(tpl?.body ?? FALLBACK_WA[milestone], vars);
      const r = await sendWhatsappText(phone, text, { kind: "pack_milestone" }).catch(() => ({ ok: false }));
      waOk = !!(r as { ok: boolean }).ok;
    }

    // Email
    let emailOk = false;
    if (!optOut && email) {
      const tpl = await getActiveTemplate("pack_milestone", "email", milestone);
      const rendered = renderTemplate(tpl?.body ?? FALLBACK_EMAIL[milestone], vars);
      const sep = rendered.indexOf("|||");
      const subject = sep >= 0 ? rendered.slice(0, sep).trim() : rendered.split("\n")[0];
      const bodyText = sep >= 0 ? rendered.slice(sep + 3).trim() : rendered;
      const r = await sendPackMilestoneEmail(email, { name: fullName, subject, bodyText, whatsappUrl: WHATSAPP_URL });
      emailOk = r.ok;
    }

    // Campana in-app (createNotification ya respeta el opt-out)
    const notifTitle = milestone === 0
      ? "¡Felicidades, lo has logrado! 🎉"
      : milestone === 5 ? "Solo 5 sesiones más, casi lo tienes" : "Estás llegando a la meta, ¡sigue así!";
    await createNotification({
      user_id: userId, type: "generic", title: notifTitle,
      body: milestone === 0
        ? `Has completado tus ${total} clases y llegado a tu meta ${vars.meta}.`
        : `Te quedan ${remaining} clases para tu meta ${vars.meta}.`,
      link: "/estudiante",
    }).catch(() => null);

    await sb.from("student_milestones").insert({
      student_id: studentId, milestone, remaining, email_ok: emailOk, whatsapp_ok: waOk,
    });

    // Aviso al profe del grupo activo
    try {
      const { data: g } = await sb
        .from("student_group_members")
        .select("student_groups!inner(teacher_id, active)")
        .eq("student_id", studentId)
        .eq("student_groups.active", true)
        .limit(1);
      const sg = g?.[0] ? (Array.isArray(g[0].student_groups) ? g[0].student_groups[0] : g[0].student_groups) : null;
      const teacherId = (sg as { teacher_id?: string } | null)?.teacher_id;
      if (teacherId) {
        const { data: t } = await sb.from("teachers").select("user_id").eq("id", teacherId).maybeSingle();
        if (t) {
          await createNotification({
            user_id: (t as { user_id: string }).user_id, type: "generic",
            title: `${fullName} — ${milestone === 0 ? "meta cumplida, dado de baja" : `${remaining} clases restantes`}`,
            body: milestone === 0
              ? `${fullName} completó sus ${total} clases. Se le dio de baja automáticamente; si renueva, admin lo reactiva.`
              : `A ${fullName} le quedan ${remaining} clases de ${total}.`,
            link: "/profesor/estudiantes",
          });
        }
      }
    } catch { /* best-effort */ }

    // 0 restantes → baja automática (si no estaba ya de baja)
    let deactivated = false;
    if (milestone === 0 && (u.active as boolean) !== false) {
      try {
        const r = await deactivateStudent(studentId, {
          reason: `Completó sus ${total} clases (baja automática, cron pack-alerts)`,
          status: "expired",
        });
        if (r.cancelledIndividualIds.length > 0) {
          await removeTeacherCalendarEvents(r.cancelledIndividualIds).catch(() => {});
        }
        deactivated = true;
      } catch (e) {
        console.error("[pack-alerts] auto-deactivate failed:", studentId, e instanceof Error ? e.message : e);
      }
    }

    details.push({ name: fullName, milestone, remaining, email: emailOk, whatsapp: waOk, deactivated });
  }

  return NextResponse.json({ ok: true, processed: details.length, details });
}
