import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase";
import { resolveSetterActor } from "@/lib/setter-auth";
import { registerContact } from "@/lib/contacts";

/**
 * POST /api/setter/leads/[id]/send-reschedule-link — botón "Reagendar"
 * del setter (Gelfis 2026-10-24).
 *
 * El setter acaba de hablar (o intentarlo) con el lead: Stiv le envía
 * por WhatsApp el enlace de reagenda con el copy "como hablamos, aquí
 * te envío el enlace…". Reutiliza sendRescheduleLinkMessage /
 * sendSesionRescheduleLinkMessage (cancelan la cita futura si existe,
 * limpian calendars, cierran cadenas) con la variante de copy "setter".
 *
 * El contacto queda registrado automáticamente como 'agendar_prueba'
 * del setter, con nota obligatoria — de ahí salen sus métricas de
 * rescate (el "rescatado" real se mide cuando el lead vuelve a agendar
 * con el enlace).
 *
 * Body: { tipo: "trial" | "sesion", note: string (min 5) }
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  tipo: z.enum(["trial", "sesion"]),
  // Nota opcional (Gelfis 2026-11-14): el flujo 1-click no pide motivo,
  // registra "Lead pidió reagendar" por defecto.
  note: z.string().trim().max(2000).optional(),
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

  // Scope del setter: lead con cita, ni convertido ni perdido.
  const { data: leadRow } = await sb
    .from("leads")
    .select("id, status, estado_cierre")
    .eq("id", leadId)
    .maybeSingle();
  if (!leadRow) return NextResponse.json({ ok: false, error: "lead_not_found" }, { status: 404 });
  const lead = leadRow as { id: string; status: string; estado_cierre: string | null };
  if (lead.status === "converted" || lead.estado_cierre === "convertido" ||
      lead.status === "lost" || lead.estado_cierre === "perdido") {
    return NextResponse.json({ ok: false, error: "lead_fuera_de_alcance" }, { status: 409 });
  }
  // (Scope ampliado 2026-11-10: cualquier lead — sendRescheduleLinkMessage
  // maneja por sí solo el caso sin cita futura con el copy de "agendar".)

  const actorName = `${setter.name} (setter)`;
  const noteText = (b.note && b.note.length >= 5) ? b.note : "Lead pidió reagendar (1-click)";
  let result: {
    ok: boolean; reason?: string;
    waSent?: boolean; emailSent?: boolean;
    pendingManual?: boolean; waText?: string; waLink?: string;
  };
  if (b.tipo === "sesion") {
    const { sendSesionRescheduleLinkMessage } = await import("@/lib/admin-actions");
    result = await sendSesionRescheduleLinkMessage(leadId, { actorName, copy: "setter" });
  } else {
    const { sendRescheduleLinkMessage } = await import("@/lib/admin-actions");
    // Manual-WA (Gelfis 2026-11-14): setter copia el texto; email automático.
    result = await sendRescheduleLinkMessage(leadId, { actorName, copy: "setter", manualWa: true });
  }

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: "send_failed", message: result.reason }, { status: 502 });
  }

  // Registrar el contacto del setter. De aquí salen las métricas; el
  // rebooking real se detecta cuando el lead usa el link.
  const canales = [
    result.pendingManual ? "WA manual" : (result.waSent ? "WA" : null),
    result.emailSent ? "email" : null,
  ].filter(Boolean).join(" + ") || "—";
  await registerContact({
    leadId,
    actor: { type: "setter", id: setter.id, name: setter.name },
    actionType: "agendar_prueba",
    channel: result.waSent ? "whatsapp" : "email",
    note: `🔗 Stiv preparó el enlace de reagenda (${canales}) — ${noteText}`,
  });

  return NextResponse.json({
    ok: true,
    wa_sent: result.waSent ?? false,
    email_sent: result.emailSent ?? false,
    pending_manual: result.pendingManual ?? false,
    wa_text: result.waText ?? null,
    wa_link: result.waLink ?? null,
  });
}
