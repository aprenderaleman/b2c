import { NextResponse, after } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { sendWhatsappText } from "@/lib/whatsapp";
import { sendTrialCancelledEmail } from "@/lib/email/send";
import { startChain } from "@/lib/chain-engine";
import { notifyTeacherClassChanged } from "@/lib/assignee-notifications";
import { removeTeacherCalendarEvents } from "@/lib/teacher-calendar-sync";

/**
 * POST /api/trial-classes/{id}/cancel
 *
 * Cancela una clase de prueba sin borrarla (status='cancelled').
 * Reemplaza el "Eliminar" del profesor por una opción NO destructiva
 * — mantiene historial completo y permite reportar/auditar. Solo el
 * superadmin puede eliminar definitivamente (endpoint /delete separado).
 *
 * ENVIA mensaje al lead — WhatsApp (kind trial_cancelled) + email
 * con CTA a /agendar/cuando (Gelfis 2026-07-03). Aplica para
 * teacher / admin / superadmin, y también si la clase ya estaba
 * en el pasado.
 *
 * AUTHZ:
 *   - teacher → solo sus propias clases.
 *   - admin / superadmin → cualquier clase.
 *
 * Side effects:
 *   - classes.status = 'cancelled'
 *   - lead_timeline: agent_note de auditoría
 *   - Si lead no tiene otra trial futura → rollback de status del lead
 *     a 'in_conversation' (igual que el endpoint /delete).
 */
export const runtime = "nodejs";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const role = (session.user as { role?: string }).role;
  const userId = (session.user as { id?: string }).id;
  if (!role || !userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id: classId } = await params;
  const sb = supabaseAdmin();

  const { data: cls } = await sb
    .from("classes")
    .select("id, teacher_id, lead_id, is_trial, status, scheduled_at")
    .eq("id", classId)
    .maybeSingle();
  if (!cls) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const c = cls as {
    id: string;
    teacher_id: string;
    lead_id: string | null;
    is_trial: boolean;
    status: string;
    scheduled_at: string;
  };
  if (!c.is_trial) {
    return NextResponse.json(
      { error: "not_a_trial", message: "Esta ruta solo cancela clases marcadas como is_trial." },
      { status: 400 },
    );
  }
  if (c.status === "cancelled") {
    return NextResponse.json({ ok: true, already_cancelled: true });
  }

  if (role === "teacher") {
    const { data: teacher } = await sb
      .from("teachers")
      .select("id")
      .eq("user_id", userId)
      .maybeSingle();
    if (!teacher || (teacher as { id: string }).id !== c.teacher_id) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  } else if (role !== "admin" && role !== "superadmin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Audit en timeline antes de cancelar (para mantener la traza).
  if (c.lead_id) {
    await sb.from("lead_timeline").insert({
      lead_id: c.lead_id,
      type:    "status_change",
      author:  role === "teacher" ? "teacher" : "admin",
      content: `🚫 Clase de prueba cancelada (${new Date(c.scheduled_at).toLocaleString("es-ES", { timeZone: "Europe/Berlin" })} Berlín)`,
      metadata: { class_id: c.id, cancelled_by_role: role, kind: "trial_cancelled" },
    });
  }

  const { error: updErr } = await sb
    .from("classes")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", classId);
  if (updErr) {
    return NextResponse.json({ error: "cancel_failed", message: updErr.message }, { status: 500 });
  }

  // Liberar el hueco en Google Calendar (central + profe) — tras
  // responder, best-effort.
  after(() => removeTeacherCalendarEvents([classId]).catch(e =>
    console.error("[trial-cancel] gcal cleanup failed:", e)));

  // Aviso al teacher — solo si el actor NO es él mismo (helper filtra).
  // Rol del actor va al label para transparencia.
  const actorLabel = role === "teacher" ? "el profe" : role === "admin" ? `${session.user?.email ?? "admin"} (admin)` : `${session.user?.email ?? "superadmin"} (superadmin)`;
  void notifyTeacherClassChanged({
    classId:      c.id,
    kind:         "cancelled",
    previousDate: c.scheduled_at,
    actorUserId:  userId,
    actorLabel,
  });

  // Notificación al lead (Gelfis 2026-07-03): WA + email con CTA a
  // reagendar. Se envía para cualquier rol que cancele (teacher /
  // admin / superadmin) y también si la clase ya estaba en el pasado.
  if (c.lead_id) {
    const { data: leadRow } = await sb
      .from("leads")
      .select("name, email, language, whatsapp_normalized")
      .eq("id", c.lead_id)
      .maybeSingle();
    const lead = leadRow as {
      name: string | null;
      email: string | null;
      language: "es" | "de" | null;
      whatsapp_normalized: string | null;
    } | null;
    if (lead) {
      const firstName = (lead.name || "").split(/\s+/)[0] || lead.name || "";
      const lang: "es" | "de" = lead.language === "de" ? "de" : "es";
      const baseUrl = (process.env.PLATFORM_URL ?? "https://b2c.aprender-aleman.de").replace(/\/$/, "");
      const rescheduleUrl = `${baseUrl}/agendar/cuando?lead=${c.lead_id}&from=trial_cancelled`;

      if (lead.whatsapp_normalized) {
        const waText = lang === "de"
          ? `¡Hola, ${firstName}! 👋\n\nDeine Deutsch-Probestunde wurde storniert.\n\nWenn du weiterhin Deutsch lernen möchtest, kannst du hier in 3 Minuten eine neue Stunde buchen:\n\n👉 ${rescheduleUrl}\n\nSag mir Bescheid, sobald du fertig bist. 😊\n\nStiv | Aprender-Aleman.de`
          : `¡Hola, ${firstName}! 👋\n\nTu clase de alemán de prueba ha sido cancelada.\n\nSi mantienes el interés en aprender alemán, puedes agendar una nueva aquí en solo 3 minutos:\n\n👉 ${rescheduleUrl}\n\nAvísame cuando lo hayas hecho. 😊\n\nStiv | Aprender-Aleman.de`;
        const waRes = await sendWhatsappText(lead.whatsapp_normalized, waText, { kind: "trial_cancelled" });
        await sb.from("lead_timeline").insert({
          lead_id: c.lead_id,
          type:    waRes.ok ? "system_message_sent" : "send_failed",
          author:  "system",
          content: waRes.ok
            ? `💬 WA cancelación enviado a ${lead.whatsapp_normalized}`
            : `💬 Falló WA cancelación: ${waRes.reason ?? "unknown"}`,
          metadata: {
            kind:      "trial_cancelled",
            channel:   "whatsapp",
            class_id:  c.id,
            cancelled_by_role: role,
          },
        });
      }

      if (lead.email) {
        const emailRes = await sendTrialCancelledEmail(lead.email, {
          leadName: firstName,
          language: lang,
          rescheduleUrl,
        });
        await sb.from("lead_timeline").insert({
          lead_id: c.lead_id,
          type:    emailRes.ok ? "system_message_sent" : "send_failed",
          author:  "system",
          content: emailRes.ok
            ? `📧 Email cancelación enviado a ${lead.email}`
            : `📧 Falló email cancelación: ${emailRes.error ?? "unknown"}`,
          metadata: {
            kind:      "trial_cancelled",
            channel:   "email",
            class_id:  c.id,
            cancelled_by_role: role,
          },
        });
      }
    }
  }

  // Si el lead ya no tiene otra trial futura, rollback status.
  if (c.lead_id) {
    const nowIso = new Date().toISOString();
    const { data: remaining } = await sb
      .from("classes")
      .select("id")
      .eq("lead_id", c.lead_id)
      .eq("is_trial", true)
      .eq("status", "scheduled")
      .gte("scheduled_at", nowIso)
      .limit(1);
    if (!remaining || remaining.length === 0) {
      const { data: leadRow } = await sb
        .from("leads")
        .select("id, status")
        .eq("id", c.lead_id)
        .maybeSingle();
      const currentStatus = (leadRow as { status?: string } | null)?.status;
      const update: Record<string, unknown> = { trial_scheduled_at: null };
      if (currentStatus === "trial_scheduled" || currentStatus === "trial_reminded") {
        update.status = "in_conversation";
      }
      await sb.from("leads").update(update).eq("id", c.lead_id);
    }

    // Iniciar cadena de follow-ups cancelación (chain6)
    await startChain(c.lead_id, "chain6_cancel")
      .catch(err => console.warn("[trial-cancel] startChain error:", err));
  }

  return NextResponse.json({ ok: true });
}
