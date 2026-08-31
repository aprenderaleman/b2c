import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase";
import { resolveSetterActor } from "@/lib/setter-auth";
import { rescheduleTrialForLead } from "@/lib/reschedule-trial";
import { listSesionSlots, SESION_MINUTES } from "@/lib/sesion-slots";
import { closeRescueChainsForRebook } from "@/lib/rescue-chains";
import { pauseAllOutbound } from "@/lib/chain-engine";
import { registerContact } from "@/lib/contacts";
import { notifyCloserSesionChanged } from "@/lib/assignee-notifications";
import { buildTrialToken, buildLeadJoinUrl } from "@/lib/trial-token";
import {
  createSesionEventForCloser,
  patchSesionEventForCloser,
  deleteSesionEventForCloser,
  getBusyForCloser,
} from "@/lib/closer-calendar-sync";

/**
 * POST /api/setter/leads/[id]/reschedule — el RESCATE del setter.
 *
 * Reagenda la cita del lead (trial o sesión de plan) usando el booking
 * que ya existe, en plena llamada. Nota OBLIGATORIA: el rescate queda
 * registrado automáticamente como contacto 'agendar_prueba' del setter
 * (así se derivan las métricas de rescatados sin campos manuales).
 *
 *   - trial  → lib/reschedule-trial.ts (misma lógica que el admin:
 *              race-guard, GCal con rollback, WA+email, cierre chain4/6).
 *   - sesión → espejo de la rama "rescheduled" de book-sesion-plan
 *              (mover la fila, tarea del closer, cierre sesion_absent,
 *              pausa outbound, GCal del closer), sin el rate-limit por
 *              IP ni el upsert de lead del funnel público.
 *
 * Body: {
 *   tipo: "trial" | "sesion",
 *   class_id: uuid,
 *   new_start_iso: datetime,
 *   new_teacher_id?: uuid,   // trial: profe del slot elegido
 *   closer_id?: uuid,        // sesión: closer del slot elegido
 *   note: string,            // min 5 — qué dijo el lead
 *   channel?: "llamada" | "whatsapp"
 * }
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PLATFORM_URL = (process.env.PLATFORM_URL ?? "https://b2c.aprender-aleman.de").replace(/\/$/, "");

const Body = z.object({
  tipo:           z.enum(["trial", "sesion"]),
  class_id:       z.string().uuid(),
  new_start_iso:  z.string().datetime(),
  new_teacher_id: z.string().uuid().optional(),
  closer_id:      z.string().uuid().optional(),
  note:           z.string().trim().min(5).max(2000),
  channel:        z.enum(["llamada", "whatsapp"]).default("llamada"),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const setter = await resolveSetterActor();
  if (!setter) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

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

  const sb = supabaseAdmin();

  // El setter no toca convertidos ni perdidos.
  const { data: leadRow } = await sb
    .from("leads")
    .select("id, name, email, whatsapp_normalized, status, estado_cierre, closer_id, german_level, goal, qualification_answers")
    .eq("id", leadId)
    .maybeSingle();
  if (!leadRow) return NextResponse.json({ ok: false, error: "lead_not_found" }, { status: 404 });
  const lead = leadRow as {
    id: string; name: string | null; email: string | null; whatsapp_normalized: string | null;
    status: string; estado_cierre: string | null; closer_id: string | null;
    german_level: string | null; goal: string | null;
    qualification_answers: { goal?: string; level?: string; deadline?: string } | null;
  };
  if (lead.status === "converted" || lead.estado_cierre === "convertido" ||
      lead.status === "lost" || lead.status === "not_qualified" || lead.estado_cierre === "perdido") {
    return NextResponse.json({ ok: false, error: "lead_fuera_de_alcance" }, { status: 409 });
  }

  let newStartLabel: string | null = null;

  if (b.tipo === "trial") {
    const result = await rescheduleTrialForLead({
      leadId,
      classId:      b.class_id,
      newStartIso:  b.new_start_iso,
      newTeacherId: b.new_teacher_id,
      actor: {
        userId:         setter.id,
        label:          `${setter.name} (setter)`,
        timelineAuthor: "setter",
      },
    });
    if (!result.ok) {
      const { status, ...rest } = result;
      return NextResponse.json({ ...rest }, { status });
    }
    newStartLabel = result.new_start_label;

    // Espejo de book-trial caso B: el lead vuelve a estado agendado.
    await sb.from("leads").update({
      status:             "trial_scheduled",
      trial_scheduled_at: result.new_start_iso,
      reschedule_state:   null,
    }).eq("id", leadId);
  } else {
    // ── Sesión de plan ──
    if (!b.closer_id) {
      return NextResponse.json({ ok: false, error: "missing_closer_id" }, { status: 400 });
    }
    const { data: clsRow } = await sb
      .from("classes")
      .select("id, lead_id, status, scheduled_at, sesion_closer_id, closer_gcal_event_id, short_code")
      .eq("id", b.class_id)
      .is("deleted_at", null)
      .maybeSingle();
    const cls = clsRow as {
      id: string; lead_id: string | null; status: string; scheduled_at: string;
      sesion_closer_id: string | null; closer_gcal_event_id: string | null; short_code: string | null;
    } | null;
    if (!cls || cls.lead_id !== leadId || !cls.sesion_closer_id) {
      return NextResponse.json({ ok: false, error: "class_not_found" }, { status: 404 });
    }
    if (cls.status !== "scheduled") {
      return NextResponse.json({ ok: false, error: "not_reschedulable", message: `status=${cls.status}` }, { status: 409 });
    }

    // Validar que el slot sigue libre (mismo criterio que el funnel).
    const slots = await listSesionSlots();
    const match = slots.find((s) => s.startIso === b.new_start_iso && s.closerId === b.closer_id);
    if (!match) {
      return NextResponse.json({ ok: false, error: "slot_taken" }, { status: 409 });
    }

    // Regla (b) del funnel: si el lead ya tiene closer, la sesión va a SU
    // closer; si su calendario externo choca, cae al closer del slot.
    const slotStartMs = new Date(b.new_start_iso).getTime();
    const slotEndMs   = slotStartMs + SESION_MINUTES * 60_000;
    const externalBlocked = async (cid: string): Promise<boolean> => {
      const busy = await getBusyForCloser(
        cid,
        new Date(slotStartMs - 60_000).toISOString(),
        new Date(slotEndMs + 60_000).toISOString(),
      );
      return busy.some((it) => slotStartMs < it.endMs && slotEndMs > it.startMs);
    };
    let finalCloserId = lead.closer_id ?? b.closer_id;
    if (finalCloserId !== b.closer_id && await externalBlocked(finalCloserId)) {
      finalCloserId = b.closer_id;
    }
    if (finalCloserId === b.closer_id && await externalBlocked(b.closer_id)) {
      return NextResponse.json({ ok: false, error: "slot_taken", reason: "closer_calendar_conflict" }, { status: 409 });
    }

    const doUpdate = (closerId: string) => sb.from("classes").update({
      scheduled_at:     b.new_start_iso,
      sesion_closer_id: closerId,
      notified_at:      null,
      notify_after_at:  new Date().toISOString(),
    }).eq("id", cls.id);

    let { error: updErr } = await doUpdate(finalCloserId);
    if (updErr && finalCloserId !== b.closer_id &&
        (updErr.code === "23505" || /no_double_booking_closer/.test(updErr.message))) {
      finalCloserId = b.closer_id;
      ({ error: updErr } = await doUpdate(finalCloserId));
    }
    if (updErr) {
      return NextResponse.json({ ok: false, error: "slot_taken" }, { status: 409 });
    }

    await sb.from("leads").update({ sesion_plan_at: b.new_start_iso }).eq("id", leadId);

    // Mover la tarea sesion_plan pendiente; si ya se completó (no-show
    // registrado), crear una nueva para la cola del closer.
    const { data: movedTareas } = await sb.from("tareas_closer")
      .update({ fecha_programada: b.new_start_iso, closer_id: finalCloserId })
      .eq("lead_id", leadId)
      .eq("tipo", "sesion_plan")
      .is("fecha_completada", null)
      .select("id");
    if (!movedTareas || movedTareas.length === 0) {
      await sb.from("tareas_closer").insert({
        closer_id: finalCloserId,
        lead_id: leadId,
        paso: 1,
        tipo: "sesion_plan",
        canal: "llamada",
        plantilla: "Sesión de Plan-Alemán (25 min) — videollamada con el lead",
        fecha_programada: b.new_start_iso,
        prioridad: "alta",
        origen: "manual",
      });
    }

    // El lead ya reagendó — cerrar sesion_absent y pausar outbounds.
    await closeRescueChainsForRebook(sb, leadId, "sesion", "sesion_rebooked");
    const pauseUntil = new Date(slotStartMs + 24 * 3600_000);
    await pauseAllOutbound(leadId, pauseUntil).catch(() => {});

    // Google Calendar del closer (best-effort, mismo criterio del funnel).
    try {
      const token = buildTrialToken(leadId, cls.id);
      const joinUrl = buildLeadJoinUrl({ classId: cls.id, leadId, shortCode: cls.short_code, baseUrl: PLATFORM_URL });
      const confirmacionUrl = `${PLATFORM_URL}/confirmacion?c=${cls.id}&t=${encodeURIComponent(token)}`;
      const qual = lead.qualification_answers ?? {};
      const eventArgs = {
        leadName: lead.name ?? "Lead",
        startIso: b.new_start_iso,
        durationMinutes: SESION_MINUTES,
        leadEmail: lead.email ?? "",
        leadWhatsapp: lead.whatsapp_normalized,
        germanLevel: qual.level ?? lead.german_level ?? "",
        goal: qual.goal ?? lead.goal ?? "",
        deadline: qual.deadline ?? "",
        joinUrl,
        confirmacionUrl,
      };
      const closerChanged = cls.sesion_closer_id !== finalCloserId;
      if (cls.closer_gcal_event_id && !closerChanged) {
        const patched = await patchSesionEventForCloser(
          finalCloserId, cls.closer_gcal_event_id, b.new_start_iso, SESION_MINUTES,
        );
        if (!patched) {
          const eventId = await createSesionEventForCloser(finalCloserId, eventArgs);
          await sb.from("classes").update({ closer_gcal_event_id: eventId }).eq("id", cls.id);
        }
      } else {
        if (closerChanged && cls.closer_gcal_event_id && cls.sesion_closer_id) {
          await deleteSesionEventForCloser(cls.sesion_closer_id, cls.closer_gcal_event_id).catch(() => {});
        }
        const eventId = await createSesionEventForCloser(finalCloserId, eventArgs);
        await sb.from("classes").update({ closer_gcal_event_id: eventId ?? null }).eq("id", cls.id);
      }
    } catch (e) {
      console.error("[setter-reschedule] gcal sync error:", e instanceof Error ? e.message : e);
    }

    newStartLabel = new Date(b.new_start_iso).toLocaleString("es-ES", {
      timeZone: "Europe/Berlin", weekday: "long", day: "numeric", month: "long",
      hour: "2-digit", minute: "2-digit",
    });

    await sb.from("lead_timeline").insert({
      lead_id: leadId,
      type: "status_change",
      author: "setter",
      content: `📋 Sesión de Plan-Alemán reagendada a ${newStartLabel} (Berlín) por ${setter.name} (setter).`,
      metadata: {
        kind: "sesion_plan_booked",
        class_id: cls.id,
        closer_id: finalCloserId,
        rescheduled: true,
        via: "setter_rescue",
      },
    });

    void notifyCloserSesionChanged({
      sesionId:     cls.id,
      kind:         "rescheduled",
      previousDate: cls.scheduled_at,
      newDate:      b.new_start_iso,
      actorUserId:  setter.id,
      actorLabel:   `${setter.name} (setter)`,
    });
  }

  // El rescate queda registrado como contacto del setter — con nota
  // obligatoria. De aquí salen las métricas de rescatados.
  const contact = await registerContact({
    leadId,
    actor: { type: "setter", id: setter.id, name: setter.name },
    actionType: "agendar_prueba",
    channel: b.channel,
    note: b.note,
    eventId: `setter_resched:${b.class_id}:${b.new_start_iso}`,
  });
  if (!contact.ok) {
    // La reagenda YA se hizo; el contacto fallido no la revierte, pero
    // lo reportamos para que la UI avise.
    return NextResponse.json({ ok: true, contact_registered: false, new_start_label: newStartLabel });
  }

  return NextResponse.json({ ok: true, contact_registered: true, new_start_label: newStartLabel });
}
