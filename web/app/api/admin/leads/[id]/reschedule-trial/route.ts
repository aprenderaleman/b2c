import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { patchTrialEvent } from "@/lib/google-calendar";
import { sendTrialRescheduledEmail } from "@/lib/email/send";
import { sendWhatsappText } from "@/lib/whatsapp";
import { formatBerlinFull } from "@/lib/time";
import { buildLeadJoinUrl } from "@/lib/trial-token";

/**
 * POST /api/admin/leads/[id]/reschedule-trial
 *
 * Disparado por el botón "Reagendar clase" en /admin/leads/[id].
 *
 * Body:
 *   {
 *     class_id:        "uuid",
 *     new_start_iso:   "2026-05-09T15:00:00Z",
 *     duration_minutes?: 30
 *   }
 *
 * Comportamiento:
 *   1. Auth admin/superadmin (session-based, no API key).
 *   2. Verifica que la clase existe, sigue scheduled, es trial y
 *      pertenece al lead de la URL.
 *   3. Race-guard: si entre el check del frontend y este confirm
 *      otra clase del mismo profe entró al hueco nuevo, devuelve 409.
 *   4. UPDATE classes.scheduled_at + reset notes_admin (para que los
 *      crons de recordatorios vuelvan a disparar).
 *   5. Patch del evento en Google Calendar si existe. Si falla,
 *      ROLLBACK del UPDATE — DB y Calendar nunca quedan
 *      desincronizados.
 *   6. Disparo en paralelo de WhatsApp + email al lead avisando del
 *      cambio + pidiendo confirmación. Failures no bloquean (ya está
 *      reagendado en BD; admin reintenta manualmente).
 *   7. Inserta entry en lead_timeline con kind=trial_rescheduled.
 *
 * Nota: NO aceptamos cambio de profesor — la UI no lo expone. Si en
 * el futuro hace falta, agregar `new_teacher_id` al body y propagar
 * al UPDATE + race-guard.
 */

export const runtime  = "nodejs";
export const dynamic  = "force-dynamic";

const Body = z.object({
  class_id:         z.string().uuid(),
  new_start_iso:    z.string().datetime(),
  duration_minutes: z.number().int().min(15).max(180).optional(),
  // Optional teacher swap. Cuando se pasa, se reasigna la clase a ese
  // teacher_id y el race-guard se ejecuta contra el NUEVO teacher (no
  // el original). Añadido 2026-06-30 para casos "el profe no puede,
  // agéndalo con Gelfis". La UI no lo expone aún.
  new_teacher_id:   z.string().uuid().optional(),
});

/**
 * Auth flexible: session admin/superadmin (UI) O CRON_SECRET (curl
 * puntual para reagendados manuales). Añadido 2026-06-30.
 */
function isCronAuthd(req: Request): boolean {
  const e = process.env.CRON_SECRET;
  if (!e) return false;
  const b = req.headers.get("authorization");
  if (b && b.toLowerCase().startsWith("bearer ") && b.slice(7).trim() === e) return true;
  return req.headers.get("x-cron-secret") === e;
}

const PLATFORM_URL = (process.env.PLATFORM_URL ?? "https://b2c.aprender-aleman.de").replace(/\/$/, "");

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const cronAuthd = isCronAuthd(req);
  const session   = cronAuthd ? null : await auth();
  if (!cronAuthd) {
    if (!session?.user) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
    const role = (session.user as { role?: string }).role;
    if (role !== "admin" && role !== "superadmin") {
      return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
    }
  }

  const { id: leadId } = await params;

  let raw: unknown;
  try { raw = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 }); }

  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "validation_failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const b = parsed.data;
  const newStart = new Date(b.new_start_iso);
  if (newStart.getTime() < Date.now()) {
    return NextResponse.json(
      { ok: false, error: "in_the_past", message: "La nueva fecha debe ser en el futuro." },
      { status: 400 },
    );
  }

  const sb = supabaseAdmin();

  // 1) Verify class belongs to this lead, is trial, scheduled.
  const { data: cls, error: clsErr } = await sb
    .from("classes")
    .select("id, status, is_trial, scheduled_at, teacher_id, lead_id, duration_minutes, google_calendar_event_id, short_code")
    .eq("id", b.class_id)
    .maybeSingle();
  if (clsErr || !cls) {
    return NextResponse.json({ ok: false, error: "class_not_found" }, { status: 404 });
  }
  type ClassRow = {
    id: string; status: string; is_trial: boolean; scheduled_at: string;
    teacher_id: string; lead_id: string | null; duration_minutes: number;
    google_calendar_event_id: string | null; short_code: string | null;
  };
  const c = cls as ClassRow;
  if (c.lead_id !== leadId) {
    return NextResponse.json(
      { ok: false, error: "class_not_for_this_lead" },
      { status: 409 },
    );
  }
  if (!c.is_trial || c.status !== "scheduled") {
    return NextResponse.json(
      { ok: false, error: "not_reschedulable", reason: `status=${c.status} is_trial=${c.is_trial}` },
      { status: 409 },
    );
  }

  const duration = b.duration_minutes ?? c.duration_minutes ?? 30;
  const slotEnd  = new Date(newStart.getTime() + duration * 60_000);
  const slotPrev = new Date(newStart.getTime() - duration * 60_000);
  // Si se pide cambio de profe, el race-guard aplica al NUEVO profe.
  const targetTeacherId = b.new_teacher_id ?? c.teacher_id;
  const teacherChanged  = !!b.new_teacher_id && b.new_teacher_id !== c.teacher_id;

  // 2) Race-guard: ¿alguien tomó el slot nuevo entre el check y este confirm?
  //    Excluimos la propia clase (estamos moviéndola).
  const { data: collisions } = await sb
    .from("classes")
    .select("id")
    .eq("teacher_id", targetTeacherId)
    .in("status", ["scheduled", "live"])
    .neq("id", c.id)
    .lt("scheduled_at", slotEnd.toISOString())
    .gte("scheduled_at", slotPrev.toISOString());
  if (collisions && collisions.length > 0) {
    return NextResponse.json(
      {
        ok:    false,
        error: "slot_taken",
        message: "El profesor ya tiene una clase agendada en ese horario. Elige otro.",
      },
      { status: 409 },
    );
  }

  // 3) UPDATE classes (opcional: reasigna teacher si new_teacher_id)
  const { error: updErr } = await sb
    .from("classes")
    .update({
      scheduled_at: newStart.toISOString(),
      // Reset markers de recordatorios — los crons (24h/morning/30m)
      // consultan notes_admin para idempotencia, así que basta con
      // limpiarlo para que re-disparen en el nuevo horario.
      notes_admin:  null,
      ...(teacherChanged ? { teacher_id: targetTeacherId } : {}),
    })
    .eq("id", c.id);
  if (updErr) {
    return NextResponse.json(
      { ok: false, error: "db_update_failed", reason: updErr.message },
      { status: 500 },
    );
  }

  // 4) Patch evento en Google Calendar (si existe)
  let gcalPatched = false;
  if (c.google_calendar_event_id) {
    try {
      gcalPatched = await patchTrialEvent(
        c.google_calendar_event_id,
        newStart.toISOString(),
        duration,
      );
    } catch (e) {
      console.error("[reschedule-trial] gcal patch threw:", e);
    }
    if (!gcalPatched) {
      // Rollback para no dejar BD y Calendar desincronizados.
      const { error: rbErr } = await sb
        .from("classes")
        .update({ scheduled_at: c.scheduled_at })
        .eq("id", c.id);
      if (rbErr) {
        console.error("[reschedule-trial] CRITICAL: gcal patch failed AND rollback failed:", rbErr);
        return NextResponse.json(
          { ok: false, error: "gcal_failed_and_rollback_failed", reason: rbErr.message },
          { status: 500 },
        );
      }
      return NextResponse.json(
        {
          ok: false, error: "gcal_failed",
          message: "El patch del evento en Google Calendar falló. La clase NO fue movida.",
        },
        { status: 500 },
      );
    }
  }

  // 5) Lead info para mensajes
  const { data: lead } = await sb
    .from("leads")
    .select("id, name, email, whatsapp_normalized, language")
    .eq("id", leadId)
    .maybeSingle();
  type LeadRow = {
    id: string; name: string | null; email: string | null;
    whatsapp_normalized: string | null; language: "es" | "de" | null;
  };
  const lr        = (lead ?? {}) as LeadRow;
  const lang      = (lr.language === "de" ? "de" : "es") as "es" | "de";
  const leadFirst = (lr.name ?? "").trim().split(/\s+/)[0] || "";
  const startDate = formatBerlinFull(newStart, lang);
  const joinUrl   = buildLeadJoinUrl({
    classId:   c.id,
    leadId:    leadId,
    shortCode: c.short_code,
    baseUrl:   PLATFORM_URL,
  });

  // 6) Notificar — email + WA en paralelo, fire-and-forget.
  const waText = lang === "de"
    ? [
        `${leadFirst}, deine kostenlose Probestunde DEUTSCH wurde verschoben.`,
        ``,
        `📅 Neuer Termin: ${startDate}`,
        `🔗 ZUM UNTERRICHTSRAUM: ${joinUrl}`,
        ``,
        `Bitte bestätige mit "Ja", dass du dabei bist 🙌`,
        ``,
        `— Aprender-Aleman.de`,
      ].join("\n")
    : [
        `${leadFirst}, hemos reagendado tu clase de prueba GRATUITA de ALEMÁN.`,
        ``,
        `📅 Nueva fecha: ${startDate}`,
        `🔗 ENLACE A LA CLASE: ${joinUrl}`,
        ``,
        `¿Me confirmas con un "Sí" que asistirás? 🙌`,
        ``,
        `— Aprender-Aleman.de`,
      ].join("\n");

  const tasks: Promise<unknown>[] = [];
  if (lr.email) {
    tasks.push(
      sendTrialRescheduledEmail(lr.email, {
        leadName:     leadFirst || "tú",
        newStartDate: startDate,
        durationMin:  duration,
        joinUrl,
        language:     lang,
      }),
    );
  }
  if (lr.whatsapp_normalized) {
    tasks.push(sendWhatsappText(lr.whatsapp_normalized, waText));
  }
  const results = await Promise.allSettled(tasks);
  const settledOk = (r: PromiseSettledResult<unknown> | undefined): boolean | null => {
    if (!r) return null;
    if (r.status !== "fulfilled") return false;
    return (r.value as { ok?: boolean }).ok === true;
  };
  const emailOk = lr.email             ? settledOk(results[0]) : null;
  const waOk    = lr.whatsapp_normalized ? settledOk(results[lr.email ? 1 : 0]) : null;

  // 7) Timeline
  const actor = cronAuthd ? "cron/curl" : (session?.user?.email ?? "admin");
  await sb.from("lead_timeline").insert({
    lead_id: leadId,
    type:    "agent_note",
    author:  cronAuthd ? "system" : "admin",
    content: `📅 Clase de prueba reagendada a ${startDate}${teacherChanged ? ` (profe cambiado)` : ""} por ${actor}.`,
    metadata: {
      kind:              "trial_rescheduled",
      class_id:          c.id,
      old_start_iso:     c.scheduled_at,
      new_start_iso:     newStart.toISOString(),
      old_teacher_id:    c.teacher_id,
      new_teacher_id:    targetTeacherId,
      teacher_changed:   teacherChanged,
      gcal_patched:      gcalPatched,
      email_sent:        emailOk,
      wa_sent:           waOk,
    },
  });

  return NextResponse.json({
    ok:           true,
    class_id:     c.id,
    new_start_iso: newStart.toISOString(),
    new_start_label: startDate,
    gcal_patched: gcalPatched,
    email_sent:   emailOk,
    wa_sent:      waOk,
    join_url:     joinUrl,
  });
}
