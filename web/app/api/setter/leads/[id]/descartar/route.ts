import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase";
import { resolveSetterActor } from "@/lib/setter-auth";
import { registerContact } from "@/lib/contacts";
import { notifyTeacherClassChanged, notifyCloserSesionChanged } from "@/lib/assignee-notifications";

/**
 * POST /api/setter/leads/[id]/descartar — botón "Descartar" (Gelfis
 * 2026-10-26). Para los "yo no agendé / fue un error / número
 * equivocado": el lead sale de TODAS las listas y nadie lo vuelve a
 * contactar.
 *
 *   1. Cancela sus citas futuras (trial y/o sesión), libera los huecos
 *      en Google Calendar y avisa al profe/closer afectado.
 *   2. Archiva el lead (status='lost' + estado_cierre='perdido' +
 *      motivo_perdido) — fuera del semáforo, de la cola del setter y
 *      de la del closer.
 *   3. Cancela cualquier cadena activa — cero mensajes futuros.
 *   4. Registra el contacto del setter con nota obligatoria.
 *
 * Body: { motivo: "no_agendo" | "numero_equivocado", note: string (min 5) }
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MOTIVO_LABEL: Record<string, string> = {
  no_agendo: "dice que no agendó / fue un error",
  numero_equivocado: "número equivocado",
};

const Body = z.object({
  motivo: z.enum(["no_agendo", "numero_equivocado"]),
  note: z.string().trim().min(5).max(2000),
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
    return NextResponse.json({ ok: false, error: "validation_failed", issues: parsed.error.issues }, { status: 400 });
  }
  const b = parsed.data;

  const sb = supabaseAdmin();
  const { data: leadRow } = await sb
    .from("leads").select("id, name, status, estado_cierre").eq("id", leadId).maybeSingle();
  if (!leadRow) return NextResponse.json({ ok: false, error: "lead_not_found" }, { status: 404 });
  const lead = leadRow as { id: string; name: string | null; status: string; estado_cierre: string | null };
  if (lead.status === "converted" || lead.estado_cierre === "convertido") {
    return NextResponse.json({ ok: false, error: "lead_fuera_de_alcance" }, { status: 409 });
  }
  const { data: citaScope } = await sb
    .from("classes").select("id").eq("lead_id", leadId).is("deleted_at", null).limit(1);
  if (!citaScope || citaScope.length === 0) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const nowIso = new Date().toISOString();
  const actorLabel = `${setter.name} (setter)`;

  // 1) Cancelar citas FUTURAS (trial y sesión) — libera huecos y avisa.
  const { data: futuras } = await sb
    .from("classes")
    .select("id, scheduled_at, is_trial, sesion_closer_id, closer_gcal_event_id")
    .eq("lead_id", leadId)
    .eq("status", "scheduled")
    .is("deleted_at", null)
    .gte("scheduled_at", nowIso);

  const canceladas: string[] = [];
  for (const cls of (futuras ?? []) as Array<{
    id: string; scheduled_at: string; is_trial: boolean;
    sesion_closer_id: string | null; closer_gcal_event_id: string | null;
  }>) {
    await sb.from("classes").update({ status: "cancelled", updated_at: nowIso }).eq("id", cls.id);
    canceladas.push(cls.id);

    if (cls.sesion_closer_id) {
      if (cls.closer_gcal_event_id) {
        const { deleteSesionEventForCloser } = await import("@/lib/closer-calendar-sync");
        deleteSesionEventForCloser(cls.sesion_closer_id, cls.closer_gcal_event_id).catch(() => {});
      }
      void notifyCloserSesionChanged({
        sesionId: cls.id,
        kind: "cancelled",
        previousDate: cls.scheduled_at,
        actorUserId: setter.id,
        actorLabel,
      });
    } else {
      const { removeTeacherCalendarEvents } = await import("@/lib/teacher-calendar-sync");
      removeTeacherCalendarEvents([cls.id]).catch(() => {});
      void notifyTeacherClassChanged({
        classId: cls.id,
        kind: "cancelled",
        previousDate: cls.scheduled_at,
        actorUserId: setter.id,
        actorLabel,
      });
    }
  }

  // 2) Archivar el lead — fuera de todas las colas y del semáforo.
  await sb.from("leads").update({
    status: "lost",
    estado_cierre: "perdido",
    motivo_perdido: `setter_descartado: ${b.motivo}`,
    trial_scheduled_at: null,
    sesion_plan_at: null,
    next_contact_date: null,
    reschedule_state: null,
  }).eq("id", leadId);

  // 3) Cero mensajes futuros.
  const { cancelActiveChain } = await import("@/lib/chain-engine");
  await cancelActiveChain(leadId, "setter_descartado").catch(() => {});

  // 4) Contacto del setter + timeline (visible para admin/profe/closer).
  await registerContact({
    leadId,
    actor: { type: "setter", id: setter.id, name: setter.name },
    actionType: "nota_libre",
    channel: "llamada",
    note: `❌ Descartado (${MOTIVO_LABEL[b.motivo]}) — ${b.note}`,
  });
  await sb.from("lead_timeline").insert({
    lead_id: leadId,
    type: "status_change",
    author: "setter",
    content: `❌ Lead descartado por ${actorLabel}: ${MOTIVO_LABEL[b.motivo]}. ${canceladas.length > 0 ? `Citas canceladas: ${canceladas.length}.` : "Sin citas futuras que cancelar."}`,
    metadata: { kind: "setter_descartado", motivo: b.motivo, cancelled_class_ids: canceladas },
  }).then(() => {}, () => {});

  return NextResponse.json({ ok: true, citas_canceladas: canceladas.length });
}
