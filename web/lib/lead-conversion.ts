import { z } from "zod";
import { supabaseAdmin } from "./supabase";
import {
  createStudent,
  subscriptionDetails,
  subscriptionTypeLabel,
  type CefrLevel,
  type SubscriptionType,
} from "./students";
import { sendWelcomeStudentEmail } from "./email/send";
import { sendWhatsappText } from "./whatsapp";
import {
  getLeadTrialTeacher,
  payConversionCommission,
  payPerformanceBonus,
  getCommissionCents,
} from "./trial-compensation";

export const ConvertBody = z.object({
  email:             z.string().trim().toLowerCase().email(),
  fullName:          z.string().trim().min(2).max(120),
  phone:             z.string().trim().min(5).max(30).nullable(),
  // Gelfis 2026-07-20: TODO en español. Aceptamos el campo por
  // compat con paneles admin viejos, pero lo pisamos a "es".
  language:          z.enum(["es", "de"]).default("es").transform(() => "es" as const),
  currentLevel:      z.enum(["A0", "A1", "A2", "B1", "B2", "C1", "C2"]),
  goal:              z.string().trim().max(300).nullable().default(null),
  subscriptionType:  z.enum(["single_classes", "package", "monthly_subscription", "combined"]),
  classesRemaining:  z.coerce.number().int().min(0).max(500).default(0),
  classesPerMonth:   z.coerce.number().int().min(0).max(100).nullable().default(null),
  monthlyPriceEuros: z.coerce.number().min(0).max(10000).nullable().default(null),
  currency:          z.enum(["EUR", "USD", "CHF"]).default("EUR"),
  // Horarios preferidos del estudiante (texto libre, e.g. "Lunes y
  // miércoles 18:00 CET"). El modal del profesor lo recoge — se
  // persiste en students.notes para que el equipo pueda agendar
  // (Gelfis 2026-06-23).
  horarios:          z.string().trim().max(300).nullable().default(null),
});

export type ConvertInput = z.infer<typeof ConvertBody>;

export type ConvertResult = {
  ok: true;
  alreadyConverted?: boolean;
  studentId: string | null;
  userId: string;
  emailSent: boolean;
  tempPassword: string | null;
};

export async function convertLeadToStudent(
  leadId: string,
  body: ConvertInput,
): Promise<ConvertResult> {
  const sb = supabaseAdmin();

  const { data: lead, error: leadErr } = await sb
    .from("leads")
    .select("id, status, whatsapp_normalized, converted_to_user_id")
    .eq("id", leadId)
    .maybeSingle();

  if (leadErr || !lead) throw new Error("lead_not_found");

  if (lead.converted_to_user_id) {
    const { data: existing } = await sb
      .from("students")
      .select("id")
      .eq("user_id", lead.converted_to_user_id)
      .maybeSingle();
    return {
      ok: true,
      alreadyConverted: true,
      studentId: existing?.id ?? null,
      userId: lead.converted_to_user_id,
      emailSent: false,
      tempPassword: null,
    };
  }

  const monthlyPriceCents = body.monthlyPriceEuros !== null
    ? Math.round(body.monthlyPriceEuros * 100)
    : null;

  const created = await createStudent({
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

  const trial = await getLeadTrialTeacher(lead.id);
  if (trial) {
    const updateFields: Record<string, unknown> = {
      trial_teacher_id: trial.teacherId,
      trial_class_id:   trial.classId,
    };

    const { data: script } = await sb
      .from("trial_class_scripts")
      .select("teacher_notes")
      .eq("class_id", trial.classId)
      .maybeSingle();

    // Combina horarios (del modal del profesor) + teacher_notes (script
    // de la clase) en students.notes. Fix Gelfis 2026-06-23: el campo
    // "Horarios" del modal antes se descartaba.
    const noteParts: string[] = [];
    if (body.horarios) noteParts.push(`Horarios preferidos: ${body.horarios}`);
    if (script?.teacher_notes) noteParts.push(script.teacher_notes);
    if (noteParts.length > 0) {
      updateFields.notes = noteParts.join("\n\n");
    }

    await sb.from("students")
      .update(updateFields)
      .eq("id", created.studentId);
  } else if (body.horarios) {
    // No hubo trial pero el profe rellenó horarios → persistir igual.
    await sb.from("students")
      .update({ notes: `Horarios preferidos: ${body.horarios}` })
      .eq("id", created.studentId);
  }

  if (trial) {
    try {
      const { data: leadMetaRow } = await sb
        .from("leads")
        .select("meta")
        .eq("id", lead.id)
        .maybeSingle();
      const meta = (leadMetaRow?.meta ?? {}) as Record<string, unknown>;
      const packId = typeof meta.last_offered_pack === "string" ? meta.last_offered_pack : null;
      const lop = meta.last_offered_payment;
      const paymentType = (lop === "flexible" || lop === "extended") ? lop as "flexible" | "extended" : "single" as const;
      if (packId && getCommissionCents(packId, paymentType) > 0) {
        const paid = await payConversionCommission({
          trialClassId: trial.classId,
          teacherId:    trial.teacherId,
          packId,
          paymentType,
        });
        if (paid && paid > 0) {
          await sb.from("lead_timeline").insert({
            lead_id: lead.id,
            type:    "agent_note",
            author:  "system",
            content: `💰 Pagada comisión de ${(paid/100).toFixed(2)}€ al profe por conversión (pack ${packId})`,
            metadata: { kind: "conversion_commission_paid", class_id: trial.classId, teacher_id: trial.teacherId, pack_id: packId, amount_cents: paid },
          });
        }
      }
    } catch (e) {
      console.error("[convert] payConversionCommission failed:", e instanceof Error ? e.message : e);
    }

    try {
      const bonus = await payPerformanceBonus({
        trialClassId: trial.classId,
        teacherId:    trial.teacherId,
      });
      if (bonus && bonus > 0) {
        await sb.from("lead_timeline").insert({
          lead_id: lead.id,
          type:    "agent_note",
          author:  "system",
          content: `🎯 Bono de desempeño: ${(bonus/100).toFixed(0)}€ (close rate ≥30%)`,
          metadata: { kind: "performance_bonus_paid", class_id: trial.classId, teacher_id: trial.teacherId, amount_cents: bonus },
        });
      }
    } catch (e) {
      console.error("[convert] payPerformanceBonus failed:", e instanceof Error ? e.message : e);
    }
  }

  await sb.from("leads")
    .update({ status: "converted", next_contact_date: null, converted_at: new Date().toISOString() })
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

  const platformUrl = process.env.PLATFORM_URL ?? "https://b2c.aprender-aleman.de";
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

  const waPhone = body.phone ?? lead.whatsapp_normalized;
  if (waPhone) {
    const firstName = body.fullName.split(/\s+/)[0] || body.fullName;
    const waText = body.language === "de"
      ? `Willkommen an der Akademie, ${firstName}! 🎉\n\nChecke deine E-Mails — wir haben dir deine Zugangsdaten zur Plattform geschickt.\nWährend wir deine erste Stunde vorbereiten, kannst du schon auf SCHULE starten. Los geht's!`
      : `¡Bienvenido a la Academia, ${firstName}! 🎉\n\nRevisa tu email — te enviamos tus accesos a la plataforma.\nMientras preparamos tu primera clase, ya puedes entrar a SCHULE para empezar a practicar. ¡Vamos!`;

    const waResult = await sendWhatsappText(waPhone, waText, { kind: "welcome_student" });
    if (!waResult.ok) {
      await sb.from("lead_timeline").insert({
        lead_id: lead.id,
        type:    "agent_note",
        author:  "system",
        content: `Welcome WhatsApp send skipped: ${waResult.reason}`,
      });
    }
  }

  return {
    ok:           true,
    studentId:    created.studentId,
    userId:       created.userId,
    emailSent:    emailResult.ok,
    tempPassword: emailResult.ok ? null : created.tempPassword,
  };
}
