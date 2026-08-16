import { NextResponse } from "next/server";
import { requireTeacherSession, assertTeacherOwnsTrialLead } from "@/lib/teacher-trial-auth";
import { markTrialAbsent } from "@/lib/admin-actions";
import { registerContact, actorFromPanelUser } from "@/lib/contacts";

export async function POST(_req: Request, { params }: { params: Promise<{ leadId: string }> }) {
  let user;
  try { user = await requireTeacherSession({ allowCloser: true }); }
  catch (err) {
    return NextResponse.json({
      error:  "unauthorized",
      detail: err instanceof Error ? err.message : String(err),
    }, { status: 401 });
  }

  const { leadId } = await params;

  try { await assertTeacherOwnsTrialLead(user.id, leadId, user.role); }
  catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.warn(`[absent] ownership check failed: user=${user.id} role=${user.role} lead=${leadId} → ${detail}`);
    return NextResponse.json({
      error:  "forbidden",
      detail,
      user_role: user.role,
    }, { status: 403 });
  }

  await markTrialAbsent(leadId);
  await registerContact({
    leadId,
    actor: await actorFromPanelUser(user),
    actionType: "no_show",
    channel: "aula",
  });
  return NextResponse.json({ ok: true });
}
