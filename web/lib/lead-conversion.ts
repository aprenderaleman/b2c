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
import { issueGarantiaCertificate, type GarantiaSource } from "./garantia-cert";
import { sendWhatsappText } from "./whatsapp";
import { getLeadTrialTeacher } from "./trial-compensation";

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

export type ConvertOptions = {
  skipLegacyCommission?: boolean;
  stripeCustomerId?: string;
  ofertaId?: string;
  conversionSource?: string;
};

export async function convertLeadToStudent(
  leadId: string,
  body: ConvertInput,
  options?: ConvertOptions,
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

  if (options?.stripeCustomerId || options?.ofertaId || options?.conversionSource) {
    const extraFields: Record<string, unknown> = {};
    if (options.stripeCustomerId) extraFields.stripe_customer_id = options.stripeCustomerId;
    if (options.ofertaId) extraFields.oferta_id = options.ofertaId;
    if (options.conversionSource) extraFields.conversion_source = options.conversionSource;
    await sb.from("students").update(extraFields).eq("id", created.studentId);
  }

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

  // Legacy commission system (trial-compensation.ts) DESACTIVADO.
  // Todas las comisiones pasan por commission-engine.ts (bono_cierre + % por rango).
  // El caller (auto-conversion.ts) llama registerBonoCierre + registerCommission directamente.

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

  // ═══ Garantía de Nivel por Escrito (Gelfis 2026-08-06) ═══
  // PDF personalizado emitido en cada conversión del Método Nativo y
  // adjuntado al email de bienvenida. También queda como certificado
  // en el perfil (panel del estudiante + ficha admin). Best-effort:
  // si falla, la conversión sigue y el cert puede emitirse después
  // desde el backfill admin.
  let garantiaAttachment: { filename: string; content: Buffer; contentType?: string } | undefined;
  try {
    let source: GarantiaSource;
    if (options?.ofertaId) {
      const { data: ofertaRow } = await sb
        .from("ofertas_enviadas")
        .select("meta, ritmo, tipo_pago, clases_totales")
        .eq("id", options.ofertaId)
        .maybeSingle();
      const ofr = ofertaRow as { meta: string; ritmo: string | null; tipo_pago: string; clases_totales: number } | null;
      source = {
        meta:            ofr?.meta ?? body.goal,
        ritmo:           ofr?.ritmo ?? null,
        tipoPago:        ofr?.tipo_pago ?? null,
        clasesTotales:   ofr?.clases_totales ?? (body.classesRemaining || null),
        fechaConversion: new Date(),
      };
    } else {
      // Conversión manual (transferencia / closer): derivar el ritmo
      // de las clases/mes cuando el combo coincide con el catálogo.
      const ritmoFromCadence =
        body.classesPerMonth === 6  ? "viajero"     :
        body.classesPerMonth === 8  ? "estandar"    :
        body.classesPerMonth === 12 ? "intensivo"   :
        body.classesPerMonth === 16 ? "vip_express" : null;
      source = {
        meta:            body.goal,
        ritmo:           body.subscriptionType === "monthly_subscription" ? ritmoFromCadence : null,
        tipoPago:        body.subscriptionType === "monthly_subscription" ? "suscripcion" : "unico",
        clasesTotales:   body.classesRemaining || null,
        fechaConversion: new Date(),
      };
    }

    if (created.studentId) {
      const issued = await issueGarantiaCertificate({
        studentId:      created.studentId,
        nombreCompleto: body.fullName,
        source,
      });
      if (issued) {
        garantiaAttachment = {
          filename:    `Garantia-de-Nivel-${issued.numero}.pdf`,
          content:     issued.pdfBuffer,
          contentType: "application/pdf",
        };
      }
    }
  } catch (e) {
    console.error("[convert] garantia issuance failed (non-fatal):", e instanceof Error ? e.message : e);
  }

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
  }, garantiaAttachment ? [garantiaAttachment] : undefined);

  if (!emailResult.ok) {
    await sb.from("lead_timeline").insert({
      lead_id: lead.id,
      type:    "agent_note",
      author:  "system",
      content: `Welcome email send FAILED: ${emailResult.error}. Temp password: ${created.tempPassword}`,
    });
  }

  await migrateLeadNotesToStudent(sb, lead.id, created.studentId).catch((e) => {
    console.error("[convert] migrateLeadNotesToStudent failed:", e instanceof Error ? e.message : e);
  });

  const waPhone = body.phone ?? lead.whatsapp_normalized;
  if (waPhone) {
    const firstName = body.fullName.split(/\s+/)[0] || body.fullName;
    // body.language forzado a "es" en el schema (línea 25) — texto ES
    // directo. Ternaria antigua rompía tsc porque nunca elige el 'de'.
    const waText = `¡Bienvenido a la Academia, ${firstName}! 🎉\n\nRevisa tu email — te enviamos tus accesos a la plataforma.\nMientras preparamos tu primera clase, ya puedes entrar a SCHULE para empezar a practicar. ¡Vamos!`;

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

type SB = ReturnType<typeof supabaseAdmin>;

async function migrateLeadNotesToStudent(
  sb: SB,
  leadId: string,
  studentId: string,
): Promise<void> {
  const { data: gelfisNotes } = await sb
    .from("gelfis_notes")
    .select("note, created_at")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: true });

  const { data: timelineNotes } = await sb
    .from("lead_timeline")
    .select("content, timestamp, author, metadata")
    .eq("lead_id", leadId)
    .in("type", ["teacher_note", "gelfis_note"])
    .order("timestamp", { ascending: true });

  const { data: adminUser } = await sb
    .from("users")
    .select("id")
    .in("role", ["superadmin", "admin"])
    .limit(1)
    .maybeSingle();

  let teacherUserId: string | null = null;
  const { data: trialClass } = await sb
    .from("trial_classes")
    .select("teacher_id")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (trialClass?.teacher_id) {
    const { data: teacher } = await sb
      .from("teachers")
      .select("user_id")
      .eq("id", trialClass.teacher_id as string)
      .maybeSingle();
    teacherUserId = (teacher as { user_id: string } | null)?.user_id ?? null;
  }

  const rows: Array<{
    target_type: string;
    target_id: string;
    author_id: string | null;
    content: string;
    created_at: string;
  }> = [];

  const seen = new Set<string>();

  for (const gn of (gelfisNotes ?? []) as Array<{ note: string; created_at: string }>) {
    const key = `gelfis:${gn.created_at}:${gn.note}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      target_type: "student",
      target_id: studentId,
      author_id: adminUser?.id ?? null,
      content: gn.note,
      created_at: gn.created_at,
    });
  }

  for (const tn of (timelineNotes ?? []) as Array<{ content: string; timestamp: string; author: string; metadata: Record<string, unknown> | null }>) {
    const isTeacher = tn.author === "teacher";
    const authorId = isTeacher ? teacherUserId : (adminUser?.id ?? null);
    const key = `${tn.author}:${tn.timestamp}:${tn.content}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      target_type: "student",
      target_id: studentId,
      author_id: authorId,
      content: tn.content,
      created_at: tn.timestamp,
    });
  }

  if (rows.length > 0) {
    await sb.from("admin_notes").insert(rows);
  }
}
