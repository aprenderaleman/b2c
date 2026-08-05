import { NextResponse } from "next/server";
import { requireTeacherSession, assertTeacherOwnsTrialLead } from "@/lib/teacher-trial-auth";
import { sendRescheduleLinkMessage } from "@/lib/admin-actions";

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

  const result = await sendRescheduleLinkMessage(leadId);
  if (!result.ok) {
    return NextResponse.json({ ok: false, reason: result.reason }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
