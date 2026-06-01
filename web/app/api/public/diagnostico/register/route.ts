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
import { after }                     from "next/server";
import { z }                          from "zod";
import { supabaseAdmin }              from "@/lib/supabase";
import { checkRateLimit, ipFromHeaders } from "@/lib/rate-limit";
import { sanitizeE164, rescueDoublePrefix } from "@/lib/phone";
import { parsePhoneNumberFromString }    from "libphonenumber-js";
import { notifyNewLeadUrgent, leadAlertsEnabled } from "@/lib/lead-alerts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ── Mapeos texto-literal → enum existente ─────────────────────────
//
// Mantén estos arrays sincronizados 1-a-1 con las opciones que
// muestra el quiz en `web/components/diagnostico/`. Si añades una
// opción al UI, AÑÁDELA aquí también o el endpoint la rechazará.

// 6 niveles MCER — etiqueta visible para el lead es exactamente el ID.
// Tras la simplificación (Gelfis 2026-05-26): pasamos de 8 sub-niveles
// a 6 estándar para reducir fricción del paso 2 del funnel.
const LEVEL_OPTIONS = [
  "A0 — Cero, no sé nada",
  "A1 — Conozco lo básico (saludos, números)",
  "A2 — Conversaciones simples del día a día",
  "B1 — Hablo de temas cotidianos con fluidez",
  "B2 — Me defiendo en contextos exigentes",
  "C1 — Nivel avanzado",
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

type GermanLevelEnum = "A0" | "A1" | "A2" | "B1" | "B2" | "C1";
const LEVEL_TO_ENUM: Record<typeof LEVEL_OPTIONS[number], GermanLevelEnum> = {
  "A0 — Cero, no sé nada":                              "A0",
  "A1 — Conozco lo básico (saludos, números)":          "A1",
  "A2 — Conversaciones simples del día a día":          "A2",
  "B1 — Hablo de temas cotidianos con fluidez":         "B1",
  "B2 — Me defiendo en contextos exigentes":            "B2",
  "C1 — Nivel avanzado":                                "C1",
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

// "otro" eliminado tras data check 2026-05-26: 0/16 conversiones (0%).
// Si alguien no encaja en los 4 motivos, no lo dirigimos al funnel.
const MOTIVOS = ["particulares","intensivo","certificado","profesional"] as const;

// Mapa de prefijo E.164 → ISO-3166-1 alpha-2. Cobre los países del
// COUNTRY_OPTIONS del componente; "+1" colapsa a US (suficiente).
// Usado para inferir country cuando el cliente nuevo (post-2026-05-26)
// ya no envía el campo (lo eliminamos del paso 5 del funnel).
const PHONE_PREFIX_TO_COUNTRY: Record<string, string> = {
  "+1787": "PR", "+1809": "DO",
  "+595": "PY", "+598": "UY", "+591": "BO", "+593": "EC",
  "+506": "CR", "+507": "PA", "+502": "GT", "+504": "HN",
  "+505": "NI", "+503": "SV", "+351": "PT",
  "+49": "DE", "+34": "ES", "+43": "AT", "+41": "CH",
  "+54": "AR", "+52": "MX", "+57": "CO", "+56": "CL",
  "+51": "PE", "+58": "VE", "+53": "CU", "+55": "BR",
  "+33": "FR", "+39": "IT", "+44": "GB", "+31": "NL", "+32": "BE",
  "+1": "US",
};
function inferCountryFromWhatsapp(whatsappE164: string): string {
  const cc = whatsappE164.startsWith("+") ? whatsappE164 : `+${whatsappE164}`;
  // Probar prefijos del más largo al más corto (e.g., +1787 antes que +1).
  for (const len of [5, 4, 3, 2]) {
    const k = cc.slice(0, len);
    if (PHONE_PREFIX_TO_COUNTRY[k]) return PHONE_PREFIX_TO_COUNTRY[k];
  }
  return "XX";
}

const BodySchema = z.object({
  name:          z.string().trim().min(2).max(100),
  email:         z.string().trim().toLowerCase().email(),
  // WhatsApp opcional desde 2026-06-01 (form en 2 pasos). Si el lead
  // sólo deja email en el paso 5a, lo creamos sin WA y el drip de
  // followups por email se encarga de la conversión. Cuando el lead
  // añade WA después (paso 5b o más tarde), se hace upsert por email.
  whatsapp_e164: z.string().trim().regex(/^\+?[0-9]{8,15}$/, "WhatsApp inválido").nullable().optional(),
  // country: opcional para clientes nuevos (post-2026-05-26). Si no
  // viene o viene null, lo inferimos del prefijo del WhatsApp.
  country:       z.string().trim().length(2).toUpperCase().optional().nullable(),
  language:      z.enum(["es", "de"]).optional().default("es"),
  // gdpr_accepted: aceptamos cualquier valor — la aceptación es
  // implícita al pulsar el CTA (disclaimer en el botón). Siempre
  // se guarda como true server-side.
  gdpr_accepted: z.boolean().optional(),
  // Paso 1 nuevo (motivo_inicial). Opcional para no romper compat con
  // clientes viejos que aún no envían el campo.
  session_id:     z.string().trim().min(8).max(64).optional(),
  motivo_inicial: z.enum(MOTIVOS).optional(),
  // Atribución publicitaria (Google Ads / UTM) — todo opcional.
  gclid:        z.string().trim().max(200).optional().nullable(),
  gbraid:       z.string().trim().max(200).optional().nullable(),
  wbraid:       z.string().trim().max(200).optional().nullable(),
  utm_source:   z.string().trim().max(120).optional().nullable(),
  utm_medium:   z.string().trim().max(120).optional().nullable(),
  utm_campaign: z.string().trim().max(200).optional().nullable(),
  utm_term:     z.string().trim().max(200).optional().nullable(),
  utm_content:  z.string().trim().max(200).optional().nullable(),
  answers: z.object({
    // Tras la simplificación del quiz (2026-05-26) sólo `level` es
    // obligatorio. Goal/urgencia/budget pasaron a la conversación
    // con Stiv por WhatsApp y pueden venir null si el cliente es
    // la nueva versión del funnel.
    level:   z.enum(LEVEL_OPTIONS),
    goal:    z.enum(GOAL_OPTIONS).nullable().optional(),
    urgency: z.enum(URGENCY_OPTIONS).nullable().optional(),
    budget:  z.enum(BUDGET_OPTIONS).nullable().optional(),
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

  // WhatsApp puede venir null (form en 2 pasos, paso 5a sin WA).
  // Si viene, lo saneamos; si no, queda como null para el upsert.
  let whatsappE164: string | null = null;
  if (b.whatsapp_e164) {
    whatsappE164 = sanitizeE164(b.whatsapp_e164);
    whatsappE164 = rescueDoublePrefix(whatsappE164);
    const parsed = parsePhoneNumberFromString(whatsappE164);
    if (parsed && parsed.isValid()) whatsappE164 = parsed.number;
  }

  // País: del WhatsApp si lo tenemos, sino se queda null por ahora.
  const parsedFinal = whatsappE164 ? parsePhoneNumberFromString(whatsappE164) : null;
  const country = (b.country && b.country.length === 2)
    ? b.country
    : (parsedFinal?.country ?? (whatsappE164 ? inferCountryFromWhatsapp(whatsappE164) : null));

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
  // Búsqueda por email siempre + whatsapp si lo tenemos. Sin WA, el
  // email es el único discriminador (form en 2 pasos, paso 5a).
  const orFilters: string[] = [`email.eq.${b.email}`];
  if (whatsappE164) orFilters.push(`whatsapp_normalized.eq.${whatsappE164}`);
  const { data: existingLead } = await sb
    .from("leads")
    .select("id, status")
    .or(orFilters.join(","))
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const enumLevel    = LEVEL_TO_ENUM[b.answers.level];
  // Goal/urgencia opcionales — si el cliente nuevo no los manda,
  // el lead queda con esos campos null y Stiv los pregunta por WA.
  const enumGoal     = b.answers.goal    ? GOAL_TO_ENUM[b.answers.goal]       : null;
  const enumUrgency  = b.answers.urgency ? URGENCY_TO_ENUM[b.answers.urgency] : null;

  const baseFields: Record<string, unknown> = {
    name:                     b.name,
    email:                    b.email,
    whatsapp_normalized:      whatsappE164,
    whatsapp_raw:             whatsappE164,
    language:                 b.language,
    german_level:             enumLevel,
    goal:                     enumGoal,
    urgency:                  enumUrgency,
    budget:                   b.answers.budget ?? null,
    country:                  country,
    diagnostico_answers:      b.answers,
    diagnostico_completed_at: new Date().toISOString(),
    gdpr_accepted:            true,
    gdpr_accepted_at:         new Date().toISOString(),
    source:                   "diagnostico",
    updated_at:               new Date().toISOString(),
  };
  // Solo escribimos motivo_inicial si vino — preservamos el valor previo
  // de leads existentes que no lo tengan.
  if (b.motivo_inicial) baseFields.motivo_inicial = b.motivo_inicial;

  // Atribución publicitaria — sólo escribimos si vino un valor, para no
  // borrar un gclid capturado en una visita anterior del mismo lead.
  if (b.gclid)        baseFields.gclid        = b.gclid;
  if (b.gbraid)       baseFields.gbraid       = b.gbraid;
  if (b.wbraid)       baseFields.wbraid       = b.wbraid;
  if (b.utm_source)   baseFields.utm_source   = b.utm_source;
  if (b.utm_medium)   baseFields.utm_medium   = b.utm_medium;
  if (b.utm_campaign) baseFields.utm_campaign = b.utm_campaign;
  if (b.utm_term)     baseFields.utm_term     = b.utm_term;
  if (b.utm_content)  baseFields.utm_content  = b.utm_content;

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

  // Enlazar la fila tempana de lead_motivo_inicial (si existe) con el
  // lead recién creado/actualizado.
  if (b.session_id) {
    await sb
      .from("lead_motivo_inicial")
      .update({ lead_id: leadId })
      .eq("session_id", b.session_id)
      .is("lead_id", null);
  }

  // Timeline note — útil para Gelfis cuando inspeccione un lead en
  // `/admin/leads/[id]` y vea de dónde viene.
  const motivoTxt = b.motivo_inicial ? `, motivo: ${b.motivo_inicial}` : "";
  await sb.from("lead_timeline").insert({
    lead_id: leadId,
    type:    "agent_note",
    author:  "system",
    content: `📋 Diagnóstico completado — nivel: ${b.answers.level}, objetivo: ${b.answers.goal ?? "(pendiente)"}, urgencia: ${b.answers.urgency ?? "(pendiente)"}, presupuesto: ${b.answers.budget ?? "(pendiente)"}, país: ${country}${motivoTxt}`,
    metadata: { kind: "diagnostico_register", answers: b.answers, country, motivo_inicial: b.motivo_inicial ?? null },
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

  // ── Alerta interna a Gelfis (3 canales: WA + email + in-app) ──────
  // Fire-and-forget: cualquier fallo se logea pero no bloquea al lead.
  // Anti-spam y kill-switch viven dentro de notifyNewLeadUrgent.
  if (leadAlertsEnabled()) {
    after(async () => {
      try {
        const r = await notifyNewLeadUrgent({
          id:                  leadId,
          name:                b.name,
          email:               b.email,
          whatsapp_normalized: whatsappE164,
          language:            b.language,
          country:             country,
          motivo_inicial:      b.motivo_inicial ?? null,
          german_level:        enumLevel,
          goal:                enumGoal,
          urgency:             enumUrgency,
          budget:              b.answers.budget ?? null,
          diagnostico_answers: Object.fromEntries(
            Object.entries(b.answers).filter(([, v]) => typeof v === "string"),
          ) as Record<string, string>,
        });
        console.log("[diagnostico/register] lead alert:", JSON.stringify(r));
      } catch (e) {
        console.error("[diagnostico/register] lead alert failed:", e instanceof Error ? e.message : e);
      }
    });
  }

  return NextResponse.json(
    { ok: true, lead_id: leadId },
    { headers: { "Cache-Control": "no-store" } },
  );
}
