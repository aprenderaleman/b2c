import { NextResponse } from "next/server";
import { requireTeacherSession, assertTeacherOwnsTrialLead } from "@/lib/teacher-trial-auth";
import { supabaseAdmin } from "@/lib/supabase";

export async function POST(_req: Request, { params }: { params: Promise<{ leadId: string }> }) {
  let user;
  try { user = await requireTeacherSession(); }
  catch { return NextResponse.json({ error: "unauthorized" }, { status: 401 }); }

  const { leadId } = await params;

  try { await assertTeacherOwnsTrialLead(user.id, leadId, user.role); }
  catch { return NextResponse.json({ error: "forbidden" }, { status: 403 }); }

  const sb = supabaseAdmin();

  const { data: cls } = await sb
    .from("classes")
    .select("id, teacher_id")
    .eq("is_trial", true)
    .eq("lead_id", leadId)
    .order("scheduled_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!cls) return NextResponse.json({ error: "no_trial_class" }, { status: 404 });

  const now = new Date().toISOString();

  const { data: existing } = await sb
    .from("trial_class_scripts")
    .select("id, voice_note_sent_at")
    .eq("class_id", cls.id)
    .maybeSingle();

  if (existing) {
    const newVal = existing.voice_note_sent_at ? null : now;
    await sb
      .from("trial_class_scripts")
      .update({ voice_note_sent_at: newVal })
      .eq("id", existing.id);
    return NextResponse.json({ ok: true, voice_note_sent_at: newVal });
  }

  await sb.from("trial_class_scripts").insert({
    class_id: cls.id,
    lead_id: leadId,
    teacher_id: user.id,
    current_step: 0,
    voice_note_sent_at: now,
  });

  return NextResponse.json({ ok: true, voice_note_sent_at: now });
}
