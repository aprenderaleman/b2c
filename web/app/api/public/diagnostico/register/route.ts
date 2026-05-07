/**
 * POST /api/public/diagnostico/register
 *
 * Endpoint del nuevo funnel en `/`. Lo llama el paso 5 (captura de
 * datos) ANTES del calendario. Guarda al lead con status='registered'
 * para que aunque abandonen en el paso 6 (calendar) no los perdamos —
 * desde aquí entran a la secuencia de followups.
 *
 * Body:
 *   {
 *     name:           "Ana Müller",
 *     email:          "ana@example.com",
 *     whatsapp_e164:  "+34611223344",
 *     country:        "ES",                       // ISO-3166-1 alpha-2
 *     language:       "es" | "de",                // opcional, default 'es'
 *     gdpr_accepted:  true,
 *     answers: {
 *       level:    "Básico (A1-A2)",       // texto literal del quiz
 *       goal:     "Trabajo",
 *       urgency:  "Lo antes posible (3 meses)",
 *       budget:   "100-300€/mes"
 *     }
 *   }
 *
 * Notas:
 *   - El budget "Menos de 100€/mes" nunca llega aquí — esos leads
 *     bouncean a la pantalla SCHULE sin completar el paso 5.
 *   - Las respuestas del quiz se mapean a los enums existentes para
 *     poblar `german_level`, `goal`, `urgency` y `budget`. Además
 *     guardamos el JSON literal en `diagnostico_answers` para no
 *     perder el texto exacto que vio el usuario (necesario para el
 *     resumen del paso 6 y para análisis).
 *   - Idempotente por email + whatsapp: si el lead ya existe lo
 *     actualizamos; si no, lo creamos. No mandamos email/WhatsApp
 *     desde aquí — eso lo hace el commit 3 (welcome inmediato) vía
 *     `after()`.
 *   - Devuelve `lead_id` para que el cliente lo guarde en
 *     localStorage y lo pase a `/api/public/book-trial` en el paso 6
 *     (así no creamos un lead duplicado).
 */

import { NextRequest, NextResponse } from "next/server";
import { z }                          from "zod";
import { supabaseAdmin }              from "@/lib/supabase";
import { checkRateLimit, ipFromHeaders } from "@/lib/rate-limit";
import { sanitizeE164 }                  from "@/lib/phone";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ── Mapeos texto-literal → enum existente ─────────────────────────
//
// Mantén estos arrays sincronizados 1-a-1 con las opciones que
// muestra el quiz en `web/components/diagnostico/`. Si añades una
// opción al UI, AÑÁDELA aquí también o el endpoint la rechazará.

const LEVEL_OPTIONS = [
  "Cero / no sé nada",
  "Básico (A1-A2)",
  "Intermedio (B1-B2)",
  "Avanzado (C1+)",
  "No estoy seguro",
] as const;

const GOAL_OPTIONS = [
  "Trabajo",
  "Estudios",
  "Vida diaria / integración",
  "Examen oficial / ciudadanía",
  "Crecimiento personal",
] as const;

const URGENCY_OPTIONS = [
  "Lo antes posible (3 meses)",
  "6 meses",
  "1 año",
  "Más de 1 año",
  "Sin fecha definida",
] as const;

const BUDGET_OPTIONS = [
  // "Menos de 100€/mes" intencionalmente excluido — esos leads no
  // llegan al endpoint, bouncean a la pantalla SCHULE.
  "100-300€/mes",
  "300-600€/mes",
  "Más de 600€/mes",
  "Estoy evaluando",
] as const;

const LEVEL_TO_ENUM: Record<typeof LEVEL_OPTIONS[number], "A0" | "A1-A2" | "B1" | "B2+" | "unsure"> = {
  "Cero / no sé nada":     "A0",
  "Básico (A1-A2)":        "A1-A2",
  "Intermedio (B1-B2)":    "B1",
  "Avanzado (C1+)":        "B2+",
  "No estoy seguro":       "unsure",
};

const GOAL_TO_ENUM: Record<typeof GOAL_OPTIONS[number], "work" | "studies" | "already_in_dach" | "exam" | "personal_growth"> = {
  "Trabajo":                       "work",
  "Estudios":                      "studies",
  "Vida diaria / integración":     "already_in_dach",
  "Examen oficial / ciudadanía":   "exam",
  "Crecimiento personal":          "personal_growth",
};

const URGENCY_TO_ENUM: Record<typeof URGENCY_OPTIONS[number], "asap" | "under_3_months" | "in_6_months" | "next_year" | "just_looking"> = {
  "Lo antes posible (3 meses)": "under_3_months",
  "6 meses":                    "in_6_months",
  "1 año":                      "next_year",
  // "Más de 1 año" y "Sin fecha definida" colapsan en 'just_looking' a
  // nivel enum; el JSONB preserva el texto exacto que escogió el lead.
  "Más de 1 año":               "just_looking",
  "Sin fecha definida":         "just_looking",
};

const BodySchema = z.object({
  name:          z.string().trim().min(2).max(100),
  email:         z.string().trim().toLowerCase().email(),
  whatsapp_e164: z.string().trim().regex(/^\+?[0-9]{8,15}$/, "WhatsApp inválido"),
  country:       z.string().trim().length(2).toUpperCase(),
  language:      z.enum(["es", "de"]).optional().default("es"),
  gdpr_accepted: z.literal(true, { errorMap: () => ({ message: "Aceptación GDPR obligatoria" }) }),
  answers: z.object({
    level:   z.enum(LEVEL_OPTIONS),
    goal:    z.enum(GOAL_OPTIONS),
    urgency: z.enum(URGENCY_OPTIONS),
    budget:  z.enum(BUDGET_OPTIONS),
  }),
});

export async function POST(req: NextRequest) {
  // Rate-limit por IP — protege contra abuso del endpoint público.
  // 10 registros / 10 min por IP es generoso para dev tooling y
  // estricto para spammers.
  const ip = ipFromHeaders(req);
  const rl = await checkRateLimit({
    scope:    "diagnostico_register",
    key:      ip,
    max:      10,
    windowMs: 10 * 60_000,
  });
  if (!rl.ok) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "validation_failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const b = parsed.data;

  // Normalizar el WhatsApp a E.164 con `+` al inicio. Defense in depth:
  // si el cliente nos pasó algo malformado (caso real "+3434615541087"
  // por country-code duplicado), saneamos colapsando un código repetido
  // al inicio.
  const whatsappE164 = sanitizeE164(b.whatsapp_e164);

  const sb = supabaseAdmin();

  // ── 0. ¿El email ya tiene una cuenta de usuario (alumno / profe /
  //       admin)? Lo cazamos AQUÍ (paso 5) y no más tarde en
  //       /api/public/book-trial — si dejamos pasar al lead, llegaría
  //       al slot picker y rebotaría con "already_registered" después
  //       de haber elegido un horario. Decisión Gelfis 2026-05-02:
  //       avisar al momento de enviar el email para que pueda
  //       cambiarlo o iniciar sesión.
  const { data: existingUser } = await sb
    .from("users")
    .select("id, email, role")
    .eq("email", b.email)
    .maybeSingle();
  if (existingUser) {
    const baseUrl = (process.env.NEXT_PUBLIC_BASE_URL ?? "https://b2c.aprender-aleman.de").replace(/\/$/, "");
    return NextResponse.json(
      {
        ok:       false,
        error:    "already_registered",
        message:  "Ya tienes cuenta. Inicia sesión para agendar.",
        login_url: `${baseUrl}/login`,
      },
      { status: 409 },
    );
  }

  // Upsert por email O whatsapp — mismo patrón que /api/public/book-trial.
  const orFilters: string[] = [`email.eq.${b.email}`, `whatsapp_normalized.eq.${whatsappE164}`];
  const { data: existingLead } = await sb
    .from("leads")
    .select("id, status")
    .or(orFilters.join(","))
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const enumLevel    = LEVEL_TO_ENUM   [b.answers.level];
  const enumGoal     = GOAL_TO_ENUM    [b.answers.goal];
  const enumUrgency  = URGENCY_TO_ENUM [b.answers.urgency];

  const baseFields = {
    name:                     b.name,
    email:                    b.email,
    whatsapp_normalized:      whatsappE164,
    whatsapp_raw:             whatsappE164,
    language:                 b.language,
    german_level:             enumLevel,
    goal:                     enumGoal,
    urgency:                  enumUrgency,
    budget:                   b.answers.budget,
    country:                  b.country,
    diagnostico_answers:      b.answers,
    diagnostico_completed_at: new Date().toISOString(),
    gdpr_accepted:            true,
    gdpr_accepted_at:         new Date().toISOString(),
    source:                   "diagnostico",
    updated_at:               new Date().toISOString(),
  };

  let leadId: string;

  if (existingLead) {
    // No degradar el estado: si ya está en 'trial_scheduled' o
    // 'converted' no lo bajamos a 'registered'. Solo subimos a
    // 'registered' desde 'new' (o estados de outreach).
    const protectedStates = new Set([
      "trial_scheduled",
      "trial_reminded",
      "trial_absent",
      "converted",
      "lost",
      "cold",
    ]);
    const update: Record<string, unknown> = { ...baseFields };
    if (!protectedStates.has(existingLead.status)) {
      update.status         = "registered";
      update.last_drip_msg_n = 0;
      update.last_drip_sent_at = null;
    }

    const { error } = await sb
      .from("leads")
      .update(update)
      .eq("id", existingLead.id);
    if (error) {
      console.error("[diagnostico/register] update failed:", error.message);
      return NextResponse.json({ ok: false, error: "db_error" }, { status: 500 });
    }
    leadId = existingLead.id;
  } else {
    const { data: inserted, error } = await sb
      .from("leads")
      .insert({
        ...baseFields,
        status:             "registered",
        last_drip_msg_n:    0,
      })
      .select("id")
      .single();
    if (error || !inserted) {
      console.error("[diagnostico/register] insert failed:", error?.message);
      return NextResponse.json({ ok: false, error: "db_error" }, { status: 500 });
    }
    leadId = inserted.id;
  }

  // Timeline note — útil para Gelfis cuando inspeccione un lead en
  // `/admin/leads/[id]` y vea de dónde viene.
  await sb.from("lead_timeline").insert({
    lead_id: leadId,
    type:    "agent_note",
    author:  "system",
    content: `📋 Diagnóstico completado — nivel: ${b.answers.level}, objetivo: ${b.answers.goal}, urgencia: ${b.answers.urgency}, presupuesto: ${b.answers.budget}, país: ${b.country}`,
    metadata: { kind: "diagnostico_register", answers: b.answers, country: b.country },
  });

  // Welcome (email + WA) NO se manda inmediato — decisión Gelfis
  // 2026-05-02: hay un buffer de 15 minutos para que el lead pueda
  // continuar al paso 6 y agendar sin recibir mensajes redundantes.
  // El cron `/api/cron/diagnostico-followups` lo dispara como msg 1
  // si el lead sigue en status='registered' tras 15 min. Si agenda
  // antes, book-trial pone status='trial_scheduled' y el welcome
  // del diagnóstico nunca sale — se envía la confirmación de la
  // clase de prueba en su lugar.
  void whatsappE164;

  return NextResponse.json(
    { ok: true, lead_id: leadId },
    { headers: { "Cache-Control": "no-store" } },
  );
}
