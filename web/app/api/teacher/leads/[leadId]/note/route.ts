import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTeacherSession, assertTeacherOwnsTrialLead } from "@/lib/teacher-trial-auth";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * POST /api/teacher/leads/[leadId]/note — nota del profesor sobre un
 * lead (perfil único: todos ven las notas de todos). Se guarda como
 * lead_timeline type='teacher_note' con el nombre del profe como autor
 * — mismo formato que las notas del Trial Hub, así aparecen en la
 * ficha del closer y del admin, y migran al estudiante al convertir.
 */
const Body = z.object({
  content: z.string().trim().min(3).max(2000),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ leadId: string }> },
) {
  let user;
  try { user = await requireTeacherSession(); }
  catch { return NextResponse.json({ error: "unauthorized" }, { status: 401 }); }

  const { leadId } = await params;

  let owns;
  try { owns = await assertTeacherOwnsTrialLead(user.id, leadId, user.role); }
  catch { return NextResponse.json({ error: "forbidden" }, { status: 403 }); }

  let raw: unknown;
  try { raw = await req.json(); }
  catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }

  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed" }, { status: 400 });
  }

  const sb = supabaseAdmin();
  const { error } = await sb.from("lead_timeline").insert({
    lead_id: leadId,
    type: "teacher_note",
    author: owns.teacherName ?? "Profesor",
    content: parsed.data.content,
  });

  if (error) {
    return NextResponse.json({ error: "insert_failed", message: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
