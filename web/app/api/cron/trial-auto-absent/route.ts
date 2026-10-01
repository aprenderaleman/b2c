import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { Resend } from "resend";
import { startChain } from "@/lib/chain-engine";

/**
 * GET/POST /api/cron/trial-auto-absent
 *
 * Dos etapas (Gelfis 2026-10-01, tras caso Alex/Myriam/Elizabeth/Debora
 * con muchos leads esperando mensajes porque el profe no marcó):
 *
 *   24-48h post-clase sin marcar:
 *     - Badge timeline "pendiente marcar"
 *     - Notif in-app al profe asignado
 *     - Email diario al admin con la lista
 *
 *   >48h post-clase sin marcar → AUTO-MARCAR como absent:
 *     - leads.trial_absent_at = NOW()
 *     - leads.status = 'trial_absent'
 *     - startChain('chain4_absent', { bypassGateOnStart: true })
 *     - Timeline audit explicando que fue el sistema
 *     - Notif in-app al profe explicando la razón
 *
 * El profe puede corregir desde el panel si realmente asistió — eso
 * resetea trial_attended_at, pero la chain4_absent ya iniciada queda
 * (podría enviarse 1 mensaje "¿todo bien?" indeseado, aceptable).
 *
 * Reemplaza la política "notify-only" de 2026-08-02 que dejaba leads
 * colgados sin follow-up si el profe se olvidaba de marcar.
 *
 * Auth: Bearer CRON_SECRET.
 */

export const runtime  = "nodejs";
export const dynamic  = "force-dynamic";

const NOTIFY_GRACE_HOURS   = 24;
const AUTO_ABSENT_HOURS    = 48;
const ALERT_EMAIL = process.env.NEW_LEAD_ALERT_EMAIL ?? "";
const RESEND_KEY  = process.env.RESEND_API_KEY ?? "";
const RESEND_FROM = process.env.RESEND_FROM_EMAIL ?? "no-reply@aprender-aleman.de";

function authorised(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const bearer = req.headers.get("authorization");
  if (bearer && bearer.toLowerCase().startsWith("bearer ") && bearer.slice(7).trim() === expected) return true;
  return req.headers.get("x-cron-secret") === expected;
}

export async function GET(req: Request)  { return run(req); }
export async function POST(req: Request) { return run(req); }

async function run(req: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "cron_not_configured" }, { status: 503 });
  }
  if (!authorised(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const sb = supabaseAdmin();
  const now = Date.now();
  const notifyCutoff   = new Date(now - NOTIFY_GRACE_HOURS * 3600_000).toISOString();
  const absentCutoff   = new Date(now - AUTO_ABSENT_HOURS  * 3600_000).toISOString();

  // Query ampliada: ahora necesitamos saber el teacher de la clase para
  // notificar + auto-marcar. Hacemos JOIN implícito via classes.
  const { data: candidates, error } = await sb
    .from("leads")
    .select("id, name, email, whatsapp_normalized, trial_scheduled_at, status")
    .lt("trial_scheduled_at", notifyCutoff)
    .is("trial_attended_at", null)
    .is("trial_absent_at", null)
    .not("status", "in", "(converted,lost,trial_attended,trial_absent)")
    .order("trial_scheduled_at", { ascending: false })
    .limit(200);

  if (error) {
    return NextResponse.json({ error: "select_failed", detail: error.message }, { status: 500 });
  }

  const rows = candidates ?? [];
  if (rows.length === 0) {
    return NextResponse.json({ ok: true, notified: 0, auto_absent: 0, scanned: 0 });
  }

  const todayIso = new Date().toISOString().slice(0, 10);
  let notified = 0;
  let autoAbsent = 0;

  for (const r of rows) {
    const scheduledMs = r.trial_scheduled_at ? new Date(r.trial_scheduled_at).getTime() : 0;
    const hoursPast   = (now - scheduledMs) / 3600_000;

    // Obtener la clase + teacher para notificar / auto-marcar.
    const { data: classRow } = await sb
      .from("classes")
      .select("id, teacher_id, scheduled_at")
      .eq("lead_id", r.id)
      .eq("is_trial", true)
      .eq("status", "scheduled")
      .lt("scheduled_at", notifyCutoff)
      .order("scheduled_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const cls = classRow as { id: string; teacher_id: string | null; scheduled_at: string } | null;
    if (!cls) continue;

    // Resolver user_id del teacher (classes.teacher_id → teachers.id → teachers.user_id).
    let teacherUserId: string | null = null;
    if (cls.teacher_id) {
      const { data: tRow } = await sb
        .from("teachers").select("user_id").eq("id", cls.teacher_id).maybeSingle();
      teacherUserId = (tRow as { user_id: string } | null)?.user_id ?? null;
    }

    // Etapa 2 (prioridad): >48h sin acción → AUTO-MARCAR como absent.
    if (hoursPast >= AUTO_ABSENT_HOURS && r.trial_scheduled_at && r.trial_scheduled_at < absentCutoff) {
      await sb.from("leads").update({
        trial_absent_at: new Date().toISOString(),
        status:          "trial_absent",
      }).eq("id", r.id);

      // Arrancar chain4_absent — el motor usará bypassGateOnStart para
      // que el primer mensaje salga YA aunque sea noche/domingo.
      const chainId = await startChain(
        r.id, "chain4_absent",
        { reserva_prioritaria: false, auto_absent_reason: "teacher_no_mark_48h" },
        { bypassGateOnStart: true },
      ).catch(() => null);

      await sb.from("lead_timeline").insert({
        lead_id: r.id,
        type:    "status_change",
        author:  "system",
        content: `Auto-marcado 'no asistió' tras ${Math.round(hoursPast)}h sin acción del profe — chain4_absent iniciada (T+20min). Si el lead sí asistió, corregir desde el panel.`,
        metadata: {
          kind:        "trial_absent_marked",
          actor:       "system_auto_48h",
          class_id:    cls.id,
          teacher_id:  cls.teacher_id,
          chain_id:    chainId,
          hours_past:  Math.round(hoursPast),
        },
      }).then(() => {}, () => {});

      // Notif in-app al profe informándole + ofreciendo corregir si asistió.
      if (teacherUserId) {
        await sb.from("notifications").insert({
          user_id:  teacherUserId,
          type:     "generic",
          title:    `⏰ Marcada como no-asistió: ${r.name ?? r.email ?? "lead"}`,
          body:     `Pasaron ${Math.round(hoursPast)}h sin marcar la clase del ${r.trial_scheduled_at?.slice(0, 16)}. El sistema la marcó como 'no asistió' y arrancó la cadena de rescate. Si en realidad asistió, corrígela desde tu panel.`,
          link:     "/profesor/clases",
          class_id: cls.id,
        }).then(() => {}, () => {});
      }
      autoAbsent++;
      continue;
    }

    // Etapa 1 (24-48h): notificar al profe + badge timeline.
    // Guard: no re-anotar leads que ya tienen el badge de hoy.
    const { data: existingToday } = await sb
      .from("lead_timeline")
      .select("id")
      .eq("lead_id", r.id)
      .eq("type", "agent_note")
      .filter("metadata->>kind", "eq", "trial_pending_review")
      .gte("created_at", `${todayIso}T00:00:00Z`)
      .limit(1);
    if (existingToday && existingToday.length > 0) continue;

    await sb.from("lead_timeline").insert({
      lead_id: r.id,
      type:    "agent_note",
      author:  "system",
      content: `⏰ Trial pendiente marcar asistencia — clase fue el ${r.trial_scheduled_at?.slice(0, 16)} y aún no está attended/absent. Revisar en /admin/leads/${r.id} y marcar manualmente. Si no se marca en las próximas ${AUTO_ABSENT_HOURS - Math.round(hoursPast)}h, se marcará automáticamente como 'no asistió'.`,
      metadata: {
        kind:               "trial_pending_review",
        trial_scheduled_at: r.trial_scheduled_at,
        current_status:     r.status,
        auto_note_date:     todayIso,
        hours_past:         Math.round(hoursPast),
      },
    }).then(() => {}, () => {});

    // Notif in-app al profe.
    if (teacherUserId) {
      await sb.from("notifications").insert({
        user_id:  teacherUserId,
        type:     "generic",
        title:    `⏰ Marca asistencia pendiente: ${r.name ?? "lead"}`,
        body:     `La clase de prueba del ${r.trial_scheduled_at?.slice(0, 16)} ya pasó pero aún no has marcado si asistió o no. Si no la marcas en las próximas ${Math.max(1, AUTO_ABSENT_HOURS - Math.round(hoursPast))}h, el sistema la marcará como 'no asistió' automáticamente.`,
        link:     "/profesor/clases",
        class_id: cls.id,
      }).then(() => {}, () => {});
    }

    notified++;
  }

  // Email digest diario al admin — solo si hay pendientes.
  if (notified > 0 && ALERT_EMAIL && RESEND_KEY) {
    try {
      const lines = [
        `${rows.length} trials pendientes de marcar attended/absent (>24h desde la clase).`,
        "",
        "Revisar en /admin/leads o /profesor/clasedeprueba:",
        "",
      ];
      for (const r of rows.slice(0, 30)) {
        lines.push(`  · ${r.name ?? r.email ?? r.id.slice(0, 8)} — clase ${r.trial_scheduled_at?.slice(0, 16)} — status=${r.status}`);
      }
      if (rows.length > 30) lines.push(`  ... y ${rows.length - 30} más`);
      lines.push("");
      lines.push(`Política 2026-10-01: tras ${AUTO_ABSENT_HOURS}h sin acción del profe el sistema auto-marca como 'no asistió' e inicia chain4_absent.`);

      const resend = new Resend(RESEND_KEY);
      await resend.emails.send({
        from:    RESEND_FROM,
        to:      ALERT_EMAIL,
        subject: `📋 ${rows.length} trials pendientes de marcar asistencia`,
        text:    lines.join("\n"),
      });
    } catch (err) {
      console.error("[trial-auto-absent] email digest failed:", err);
    }
  }

  return NextResponse.json({
    ok:          true,
    scanned:     rows.length,
    notified,
    auto_absent: autoAbsent,
    pattern:     "notify_24h_then_auto_absent_48h",
    notify_grace_hours: NOTIFY_GRACE_HOURS,
    auto_absent_hours:  AUTO_ABSENT_HOURS,
  });
}
