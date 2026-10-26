import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase";
import { resolveSetterActor } from "@/lib/setter-auth";
import { registerContact } from "@/lib/contacts";
import { sendSetterAccessMessage } from "@/lib/setter-messages";

/**
 * POST /api/setter/leads/[id]/confirm — botón "Confirmado" (Gelfis
 * 2026-10-26). Registra el CONFIRMO del setter y, acto seguido, el lead
 * recibe por WhatsApp (Stiv) + email: "gracias por confirmar" + enlace
 * para unirse + "Wir sehen uns am {fecha}".
 *
 * El envío es best-effort: el confirmo queda registrado aunque los
 * canales fallen (la UI avisa).
 *
 * Body: { note: string (min 5) }
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
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
    return NextResponse.json({ ok: false, error: "nota_corta" }, { status: 400 });
  }

  const sb = supabaseAdmin();
  const { data: leadRow } = await sb
    .from("leads")
    .select("id, status, estado_cierre")
    .eq("id", leadId)
    .maybeSingle();
  if (!leadRow) return NextResponse.json({ ok: false, error: "lead_not_found" }, { status: 404 });
  const lead = leadRow as { status: string; estado_cierre: string | null };
  if (lead.status === "converted" || lead.estado_cierre === "convertido" ||
      lead.status === "lost" || lead.estado_cierre === "perdido") {
    return NextResponse.json({ ok: false, error: "lead_fuera_de_alcance" }, { status: 409 });
  }
  const { data: cita } = await sb
    .from("classes").select("id").eq("lead_id", leadId).is("deleted_at", null).limit(1);
  if (!cita || cita.length === 0) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  // 1) El confirmo del setter — esto lo saca de su lista de pendientes.
  const contact = await registerContact({
    leadId,
    actor: { type: "setter", id: setter.id, name: setter.name },
    actionType: "confirmar_cita",
    channel: "llamada",
    note: parsed.data.note,
  });
  if (!contact.ok) {
    const status = contact.error === "db_error" ? 500 : 400;
    return NextResponse.json({ ok: false, error: contact.error }, { status });
  }

  // 2) Gracias + enlace + "Wir sehen uns am {fecha}" (WA + email).
  const send = await sendSetterAccessMessage(leadId, "confirmed", setter.name);

  // 3) Que el profe (o closer) de la cita LO VEA (Gelfis 2026-10-26):
  //    trial_confirmed_at enciende el badge "confirmó asistencia" del
  //    Trial Hub, y además le llega notificación in-app.
  try {
    await sb.from("leads")
      .update({ trial_confirmed_at: new Date().toISOString() })
      .eq("id", leadId)
      .is("trial_confirmed_at", null);

    const { data: clsRow } = await sb
      .from("classes")
      .select("id, scheduled_at, teacher_id, sesion_closer_id, leads:lead_id(name)")
      .eq("lead_id", leadId)
      .eq("status", "scheduled")
      .is("deleted_at", null)
      .gte("scheduled_at", new Date().toISOString())
      .order("scheduled_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    const cls = clsRow as unknown as {
      id: string; scheduled_at: string; teacher_id: string | null;
      sesion_closer_id: string | null; leads: { name: string | null } | null;
    } | null;
    if (cls) {
      const leadName = cls.leads?.name ?? "El lead";
      const { formatBerlinShort } = await import("@/lib/time");
      const fecha = formatBerlinShort(cls.scheduled_at);
      let notifyUserId: string | null = cls.sesion_closer_id;
      let link = "/closer/sesiones";
      if (!notifyUserId && cls.teacher_id) {
        const { data: t } = await sb.from("teachers").select("user_id").eq("id", cls.teacher_id).maybeSingle();
        notifyUserId = (t as { user_id: string } | null)?.user_id ?? null;
        link = "/profesor/clasedeprueba";
      }
      if (notifyUserId) {
        await sb.from("notifications").insert({
          user_id: notifyUserId,
          type: "class_updated",
          title: `✅ ${leadName} confirmó su asistencia`,
          body: `Confirmado por teléfono por ${setter.name} (setter) — cita del ${fecha}.`,
          link,
          class_id: cls.id,
        }).then(() => {}, () => {});
      }
    }
  } catch (e) {
    console.error("[setter-confirm] notify teacher/closer failed:", e);
  }

  return NextResponse.json({
    ok: true,
    wa_sent: send.waSent,
    email_sent: send.emailSent,
    start_label: send.startLabel,
    send_reason: send.ok ? null : send.reason ?? null,
  });
}
