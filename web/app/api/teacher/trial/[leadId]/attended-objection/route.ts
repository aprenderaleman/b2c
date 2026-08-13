import { NextResponse } from "next/server";
import { requireTeacherSession, assertTeacherOwnsTrialLead } from "@/lib/teacher-trial-auth";
import { markTrialAttendedWithObjection } from "@/lib/admin-actions";

const VALID_CHIPS = ["precio", "pensarlo", "pareja", "tiempo"] as const;

export async function POST(req: Request, { params }: { params: Promise<{ leadId: string }> }) {
  let user;
  try { user = await requireTeacherSession({ allowCloser: true }); }
  catch { return NextResponse.json({ error: "unauthorized" }, { status: 401 }); }

  const { leadId } = await params;

  try { await assertTeacherOwnsTrialLead(user.id, leadId, user.role); }
  catch { return NextResponse.json({ error: "forbidden" }, { status: 403 }); }

  let body: { chip?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }

  const chip = body.chip;
  if (!chip || !VALID_CHIPS.includes(chip as typeof VALID_CHIPS[number])) {
    return NextResponse.json(
      { error: "invalid_chip", valid: VALID_CHIPS },
      { status: 400 },
    );
  }

  await markTrialAttendedWithObjection(leadId, chip as typeof VALID_CHIPS[number]);
  return NextResponse.json({ ok: true });
}
