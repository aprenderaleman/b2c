import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { sendWelcomeStudentEmail } from "@/lib/email/send";
import { subscriptionTypeLabel, subscriptionDetails, type SubscriptionType } from "@/lib/students";

/**
 * POST /api/admin/leads/[id]/resend-welcome-student
 *
 * Reenvía el email de bienvenida al student ya convertido, con
 * instrucciones para hacer login en /login (Gelfis 2026-08-31,
 * caso Saidys: el primer intento falló por config SMTP y el email
 * nunca llegó).
 *
 * Body (opcional):
 *   { tempPassword?: string }   — si se pasa, sobrescribe la contraseña
 *                                 temporal que va en el email. Si NO se
 *                                 pasa, se busca la última guardada por
 *                                 el timeline entry del fallo original.
 *
 * NO hace reset de la contraseña del user — solo re-envía el mismo email.
 * Si el student ya cambió su password, el `tempPassword` incluido en el
 * email será obsoleto (el email le indicará que puede pedir reset).
 */
export const runtime = "nodejs";

const PLATFORM_URL = process.env.NEXT_PUBLIC_PLATFORM_URL || "https://b2c.aprender-aleman.de";
const HANS_URL     = process.env.HANS_URL   || "https://hans.aprender-aleman.de";
const SCHULE_URL   = process.env.SCHULE_URL || "https://schule.aprender-aleman.de";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const role = (session.user as { role?: string }).role;
  if (role !== "admin" && role !== "superadmin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id: leadId } = await params;
  const sb = supabaseAdmin();

  const { data: leadRow } = await sb
    .from("leads")
    .select("id, name, email, language, converted_at")
    .eq("id", leadId)
    .maybeSingle();
  const lead = leadRow as {
    id: string; name: string | null; email: string | null;
    language: "es" | "de" | null; converted_at: string | null;
  } | null;
  if (!lead) return NextResponse.json({ error: "lead_not_found" }, { status: 404 });
  if (!lead.email) return NextResponse.json({ error: "lead_no_email" }, { status: 400 });
  if (!lead.converted_at) return NextResponse.json({ error: "not_converted" }, { status: 400 });

  const { data: studentRow } = await sb
    .from("students")
    .select("subscription_type, classes_remaining, classes_per_month, monthly_price_cents, currency")
    .eq("lead_id", leadId)
    .maybeSingle();
  const student = studentRow as {
    subscription_type: SubscriptionType | null;
    classes_remaining: number | null;
    classes_per_month: number | null;
    monthly_price_cents: number | null;
    currency: string | null;
  } | null;
  if (!student) return NextResponse.json({ error: "student_not_found" }, { status: 404 });

  // Resolver tempPassword: body override → timeline fallo original → error
  let tempPassword: string | null = null;
  try {
    const bodyRaw = await req.json().catch(() => ({}));
    const body = bodyRaw as { tempPassword?: string };
    if (typeof body?.tempPassword === "string" && body.tempPassword.trim().length > 0) {
      tempPassword = body.tempPassword.trim();
    }
  } catch { /* no body */ }
  if (!tempPassword) {
    const { data: failEntry } = await sb
      .from("lead_timeline")
      .select("content")
      .eq("lead_id", leadId)
      .ilike("content", "%Temp password:%")
      .order("timestamp", { ascending: false })
      .limit(1)
      .maybeSingle();
    const content = (failEntry as { content: string } | null)?.content ?? "";
    const match = content.match(/Temp password:\s*(\S+)/);
    if (match) tempPassword = match[1];
  }
  if (!tempPassword) {
    return NextResponse.json({
      error: "no_temp_password",
      message: "No se encontró la temp password original en timeline; pásala en body.tempPassword",
    }, { status: 400 });
  }

  const language: "es" | "de" = lead.language === "de" ? "de" : "es";
  const firstName = (lead.name ?? "").split(/\s+/)[0] || (lead.name ?? "");

  const emailRes = await sendWelcomeStudentEmail(lead.email, {
    name:                firstName,
    email:               lead.email,
    tempPassword,
    platformUrl:         PLATFORM_URL,
    hansUrl:             HANS_URL,
    schuleUrl:           SCHULE_URL,
    subscriptionLabel:   subscriptionTypeLabel((student.subscription_type ?? "monthly_subscription") as SubscriptionType, language),
    subscriptionDetails: subscriptionDetails({
      subscriptionType:  (student.subscription_type ?? "monthly_subscription") as SubscriptionType,
      classesRemaining:  student.classes_remaining ?? 0,
      classesPerMonth:   student.classes_per_month ?? 0,
      monthlyPriceCents: student.monthly_price_cents ?? 0,
      currency:          ((student.currency ?? "EUR") as "EUR" | "USD" | "CHF"),
    }, language),
    language,
  });

  await sb.from("lead_timeline").insert({
    lead_id: leadId,
    type:    emailRes.ok ? "system_message_sent" : "send_failed",
    author:  session.user?.email ?? "admin",
    content: emailRes.ok
      ? `📧 Welcome email REENVIADO a ${lead.email} (admin manual)`
      : `📧 Reenvío welcome email FAILED: ${emailRes.error}`,
    metadata: { kind: "welcome_student_resent", channel: "email" },
  });

  if (!emailRes.ok) {
    return NextResponse.json({ ok: false, error: emailRes.error }, { status: 500 });
  }
  return NextResponse.json({ ok: true, to: lead.email });
}
