import { NextResponse } from "next/server";
import { requireTeacherSession, assertTeacherOwnsTrialLead } from "@/lib/teacher-trial-auth";
import { sendRescheduleLinkMessage } from "@/lib/admin-actions";
import { supabaseAdmin } from "@/lib/supabase";
import { registerContact, actorFromPanelUser } from "@/lib/contacts";

/**
 * POST /api/teacher/trial/[leadId]/send-reschedule-link
 *
 * Envía por WhatsApp al lead el enlace de /agendar/cuando para que
 * elija un nuevo horario. NO cambia estado del lead ni cancela la
 * clase — solo un mensaje. Usado desde TrialHubCard cuando el profe
 * quiere ofrecer un cambio de horario amablemente.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ leadId: string }> }) {
  let user;
  try { user = await requireTeacherSession({ allowCloser: true }); }
  catch { return NextResponse.json({ error: "unauthorized" }, { status: 401 }); }

  const { leadId } = await params;

  try { await assertTeacherOwnsTrialLead(user.id, leadId, user.role); }
  catch { return NextResponse.json({ error: "forbidden" }, { status: 403 }); }

  const { data: userRow } = await supabaseAdmin()
    .from("users").select("full_name").eq("id", user.id).maybeSingle();
  const actorName = (userRow as { full_name: string | null } | null)?.full_name || user.email;

  const result = await sendRescheduleLinkMessage(leadId, { actorName });
  if (!result.ok) {
    return NextResponse.json({ ok: false, reason: result.reason }, { status: 400 });
  }
  await registerContact({
    leadId,
    actor: await actorFromPanelUser(user),
    actionType: "agendar_prueba",
    channel: "whatsapp",
    note: "Enlace de agendar clase de prueba enviado",
  });
  return NextResponse.json({ ok: true });
}
