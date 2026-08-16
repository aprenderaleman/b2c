import { NextResponse } from "next/server";
import { requireTeacherSession, assertTeacherOwnsTrialLead } from "@/lib/teacher-trial-auth";
import { markTrialAttendedNoLink } from "@/lib/admin-actions";
import { registerContact, actorFromPanelUser } from "@/lib/contacts";

export async function POST(_req: Request, { params }: { params: Promise<{ leadId: string }> }) {
  let user;
  try { user = await requireTeacherSession({ allowCloser: true }); }
  catch { return NextResponse.json({ error: "unauthorized" }, { status: 401 }); }

  const { leadId } = await params;

  try { await assertTeacherOwnsTrialLead(user.id, leadId, user.role); }
  catch { return NextResponse.json({ error: "forbidden" }, { status: 403 }); }

  await markTrialAttendedNoLink(leadId);
  await registerContact({
    leadId,
    actor: await actorFromPanelUser(user),
    actionType: "asistio",
    channel: "aula",
  });
  return NextResponse.json({ ok: true });
}
