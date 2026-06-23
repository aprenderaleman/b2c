import { NextResponse } from "next/server";
import { requireTeacherSession, assertTeacherOwnsTrialLead } from "@/lib/teacher-trial-auth";
import { createAdminNotification } from "@/lib/admin-notifications";
import { supabaseAdmin } from "@/lib/supabase";
import { sendWhatsappText } from "@/lib/whatsapp";

export async function POST(req: Request, { params }: { params: Promise<{ leadId: string }> }) {
  let user;
  try { user = await requireTeacherSession(); }
  catch { return NextResponse.json({ error: "unauthorized" }, { status: 401 }); }

  const { leadId } = await params;

  let teacherName: string;
  try {
    const result = await assertTeacherOwnsTrialLead(user.id, leadId);
    teacherName = result.teacherName ?? user.id;
  } catch {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let message = "";
  try {
    const raw = (await req.json()) as Record<string, unknown>;
    message = typeof raw.message === "string" ? raw.message.trim() : "";
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  if (message.length < 3) {
    return NextResponse.json({ error: "message_too_short" }, { status: 400 });
  }

  const sb = supabaseAdmin();

  const { data: lead } = await sb
    .from("leads")
    .select("name, whatsapp_normalized")
    .eq("id", leadId)
    .maybeSingle();

  const leadName = lead?.name ?? "Lead";

  // Fix Gelfis 2026-06-23: el profe escala porque pasó algo raro →
  // status=needs_human para PARAR todos los flows automáticos (drips,
  // post_trial_followup, absent_followup, summer_promo, etc) hasta
  // que Gelfis intervenga manualmente.
  await sb.from("leads")
    .update({ status: "needs_human", next_contact_date: null })
    .eq("id", leadId);

  await sb.from("lead_timeline").insert({
    lead_id: leadId,
    type:    "status_change",
    author:  teacherName,
    content: `Escalado por profesor → needs_human. Motivo: ${message}`,
    metadata: { kind: "teacher_escalation", from_teacher: teacherName },
  });

  await sb.from("lead_timeline").insert({
    lead_id: leadId,
    type:    "agent_note",
    author:  teacherName,
    content: `🚨 Escalado por profesor: ${message}`,
  });

  await createAdminNotification({
    type:       "teacher_escalation",
    severity:   "warning",
    title:      `${teacherName} escalo a ${leadName}`,
    body:       message,
    lead_id:    leadId,
    action_url: `/admin/leads/${leadId}`,
    dedupeHours: false,
  });

  const adminWa = (process.env.NEW_LEAD_ALERT_WHATSAPP ?? "").trim();
  if (adminWa) {
    await sendWhatsappText(
      adminWa,
      `🚨 *Escalacion de ${teacherName}*\n\nLead: ${leadName}\nMensaje: ${message}\n\nVer: ${process.env.PLATFORM_URL ?? "https://b2c.aprender-aleman.de"}/admin/leads/${leadId}`,
    );
  }

  return NextResponse.json({ ok: true });
}
