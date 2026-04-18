import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import {
  createStudent,
  subscriptionDetails,
  subscriptionTypeLabel,
  type CefrLevel,
  type SubscriptionType,
} from "@/lib/students";
import { sendWelcomeStudentEmail } from "@/lib/email/send";
import { sendWhatsappText } from "@/lib/whatsapp";

/**
 * POST /api/admin/leads/[id]/convert
 *
 * Converts an existing lead into a paying student. Body schema below.
 * The endpoint is idempotent on `status = 'converted'`: if the lead was
 * already converted, we 200-return the existing student_id.
 *
 * Side effects (in order):
 *   1. Creates users row (role='student') + students row.
 *   2. Marks leads.status = 'converted', points converted_to_user_id.
 *   3. Logs a 'conversion' entry on lead_timeline.
 *   4. Fires welcome email (via Resend).
 *   5. Fires welcome WhatsApp (via agents VPS internal endpoint).
 *
 * Email / WhatsApp failures are logged but do NOT roll back the
 * conversion — a missing email or VPS blip shouldn't undo the business
 * decision to promote the lead.
 */

const ConvertBody = z.object({
  email:             z.string().trim().toLowerCase().email(),
  fullName:          z.string().trim().min(2).max(120),
  phone:             z.string().trim().min(5).max(30).nullable(),
  language:          z.enum(["es", "de"]).default("es"),

  currentLevel:      z.enum(["A0", "A1", "A2", "B1", "B2", "C1", "C2"]),
  goal:              z.string().trim().max(300).nullable().default(null),

  subscriptionType:  z.enum(["single_classes", "package", "monthly_subscription", "combined"]),
  classesRemaining:  z.coerce.number().int().min(0).max(500).default(0),
  classesPerMonth:   z.coerce.number().int().min(0).max(100).nullable().default(null),
  monthlyPriceEuros: z.coerce.number().min(0).max(10000).nullable().default(null),
  currency:          z.enum(["EUR", "USD", "CHF"]).default("EUR"),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id: leadId } = await params;

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
  const body = parsed.data;

  const sb = supabaseAdmin();

  // Fetch the lead to validate existence and get whatsapp_normalized.
  const { data: lead, error: leadErr } = await sb
    .from("leads")
    .select("id, status, whatsapp_normalized, converted_to_user_id")
    .eq("id", leadId)
    .maybeSingle();

  if (leadErr || !lead) {
    return NextResponse.json({ error: "lead_not_found" }, { status: 404 });
  }

  // Idempotent: if we've already converted this lead, report success with
  // the existing student record.
  if (lead.converted_to_user_id) {
    const { data: existing } = await sb
      .from("students")
      .select("id")
      .eq("user_id", lead.converted_to_user_id)
      .maybeSingle();
    return NextResponse.json({
      ok:               true,
      alreadyConverted: true,
      studentId:        existing?.id ?? null,
      userId:           lead.converted_to_user_id,
    });
  }

  // Build + persist the student.
  const monthlyPriceCents = body.monthlyPriceEuros !== null
    ? Math.round(body.monthlyPriceEuros * 100)
    : null;

  let created;
  try {
    created = await createStudent({
      email:             body.email,
      fullName:          body.fullName,
      phone:             body.phone ?? lead.whatsapp_normalized,
      language:          body.language,
      leadId:            lead.id,
      currentLevel:      body.currentLevel as CefrLevel,
      goal:              body.goal,
      subscriptionType:  body.subscriptionType as SubscriptionType,
      classesRemaining:  body.classesRemaining,
      classesPerMonth:   body.classesPerMonth,
      monthlyPriceCents: monthlyPriceCents,
      currency:          body.currency,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    // Duplicate email is the most common failure — surface it nicely.
    if (/duplicate key|already exists/i.test(msg)) {
      return NextResponse.json(
        { error: "email_already_in_use", message: "Ese correo ya pertenece a otro usuario." },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: "create_student_failed", message: msg }, { status: 500 });
  }

  // Mark the lead as converted and log the event.
  await sb.from("leads")
    .update({ status: "converted", next_contact_date: null })
    .eq("id", lead.id);

  await sb.from("lead_timeline").insert({
    lead_id: lead.id,
    type:    "conversion",
    author:  "gelfis",
    content: `Converted to student (${body.subscriptionType}). Email: ${body.email}`,
    metadata: {
      user_id:           created.userId,
      student_id:        created.studentId,
      subscription_type: body.subscriptionType,
    },
  });

  // ── Welcome email (awaited so we can log failures in the timeline).
  const platformUrl = process.env.PLATFORM_URL ?? "https://live.aprender-aleman.de";
  const hansUrl     = process.env.HANS_URL     ?? "https://hans.aprender-aleman.de";
  const schuleUrl   = process.env.SCHULE_URL   ?? "https://schule.aprender-aleman.de";

  const emailResult = await sendWelcomeStudentEmail(body.email, {
    name:                body.fullName.split(/\s+/)[0] || body.fullName,
    email:               body.email,
    tempPassword:        created.tempPassword,
    platformUrl,
    hansUrl,
    schuleUrl,
    subscriptionLabel:   subscriptionTypeLabel(body.subscriptionType as SubscriptionType, body.language),
    subscriptionDetails: subscriptionDetails(
      {
        subscriptionType:  body.subscriptionType as SubscriptionType,
        classesRemaining:  body.classesRemaining,
        classesPerMonth:   body.classesPerMonth,
        monthlyPriceCents: monthlyPriceCents,
        currency:          body.currency,
      },
      body.language,
    ),
    language: body.language,
  });

  if (!emailResult.ok) {
    await sb.from("lead_timeline").insert({
      lead_id: lead.id,
      type:    "agent_note",
      author:  "system",
      content: `Welcome email send FAILED: ${emailResult.error}. Temp password: ${created.tempPassword}`,
    });
  }

  // ── Welcome WhatsApp via the agents VPS (best-effort).
  const waPhone = body.phone ?? lead.whatsapp_normalized;
  if (waPhone) {
    const firstName = body.fullName.split(/\s+/)[0] || body.fullName;
    const waText = body.language === "de"
      ? `Willkommen an der Akademie, ${firstName}! 🎉

Checke deine E-Mails — wir haben dir deine Zugangsdaten zur Plattform geschickt.
Während wir deine erste Stunde vorbereiten, kannst du schon auf SCHULE und HANS starten. Los geht's!`
      : `¡Bienvenido a la Academia, ${firstName}! 🎉

Revisa tu email — te enviamos tus accesos a la plataforma.
Mientras preparamos tu primera clase, ya puedes entrar a SCHULE y HANS para empezar a practicar. ¡Vamos!`;

    const waResult = await sendWhatsappText(waPhone, waText);
    if (!waResult.ok) {
      await sb.from("lead_timeline").insert({
        lead_id: lead.id,
        type:    "agent_note",
        author:  "system",
        content: `Welcome WhatsApp send skipped: ${waResult.reason}`,
      });
    }
  }

  return NextResponse.json({
    ok:           true,
    studentId:    created.studentId,
    userId:       created.userId,
    emailSent:    emailResult.ok,
    // Only surface the temp password when the email failed, so admin
    // can relay it manually. Otherwise it only lives in the sent email.
    tempPassword: emailResult.ok ? null : created.tempPassword,
  });
}
