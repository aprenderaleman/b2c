import { NextResponse } from "next/server";
import { requireTeacherSession, assertTeacherOwnsTrialLead } from "@/lib/teacher-trial-auth";
import { ConvertBody, convertLeadToStudent } from "@/lib/lead-conversion";

export async function POST(req: Request, { params }: { params: Promise<{ leadId: string }> }) {
  let user;
  try { user = await requireTeacherSession(); }
  catch { return NextResponse.json({ error: "unauthorized" }, { status: 401 }); }

  const { leadId } = await params;

  try { await assertTeacherOwnsTrialLead(user.id, leadId); }
  catch { return NextResponse.json({ error: "forbidden" }, { status: 403 }); }

  let rawBody: unknown;
  try { rawBody = await req.json(); }
  catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }

  const parsed = ConvertBody.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_failed", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const result = await convertLeadToStudent(leadId, parsed.data);
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    if (msg === "lead_not_found") {
      return NextResponse.json({ error: "lead_not_found" }, { status: 404 });
    }
    if (/duplicate key|already exists/i.test(msg)) {
      return NextResponse.json(
        { error: "email_already_in_use", message: "Ese correo ya pertenece a otro usuario." },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: "create_student_failed", message: msg }, { status: 500 });
  }
}
