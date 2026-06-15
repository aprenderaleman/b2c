"use client";

/**
 * Diagnostico funnel — el quiz que vive en `/`.
 *
 * State machine de un solo componente cliente. NO usamos URL-driven
 * steps (a diferencia de `/agendar`) porque:
 *
 *   - El usuario debe poder retroceder con la flecha y mantener sus
 *     respuestas; con URL routing perderíamos el estado entre `next/link`s.
 *   - Más rápido — sin re-render por navegación.
 *   - El back-button del navegador no aplica al quiz (lo gestionamos
 *     con la flecha del shell).
 *
 * Pasos:
 *   1-4: preguntas de selección única
 *   4-bis: pantalla SCHULE (solo si budget = "Menos de 100€/mes")
 *   5: captura de datos + POST /api/public/diagnostico/register
 *   6: resumen de respuestas + redirect a /agendar/cuando
 *
 * Pixel events (Meta + TikTok) se disparan al completar el paso 5.
 * Si los pixels no están configurados (env vacías), las llamadas
 * son no-ops gracias al wrapper en `lib/pixels.ts`.
 */

import { useState, useMemo, useEffect } from "react";
import Link                             from "next/link";
import { firePixelLead, firePixelSchedule } from "@/lib/pixels";
import { MobileDayStrip }               from "@/components/agendar/MobileDayStrip";
import { TimeList, type SlotItem }      from "@/components/agendar/TimeList";
import { BrandLogo }                    from "@/components/BrandLogo";
import { IllustrationPanel }            from "./IllustrationPanel";
import { resolvePhone }                 from "@/lib/phone";
import { detectCountryFromBrowser, detectBrowserTimezone } from "@/lib/timezone-country";

// ── Opciones del quiz (sincronizadas 1-a-1 con el endpoint
//    /api/public/diagnostico/register — si cambias texto aquí cámbialo
//    también allá o el server rechazará el body) ──────────────────

// 6 niveles MCER (Gelfis 2026-05-26). Simplificado de 8 sub-niveles a
// 6 estándar para bajar fricción del paso 2. Mantén estas 1-a-1 con
// el endpoint /api/public/diagnostico/register o el server rechaza el body.
const LEVEL_OPTIONS = [
  { id: "A0 — Cero, no sé nada",                          emoji: "🌱" },
  { id: "A1 — Conozco lo básico (saludos, números)",      emoji: "📗" },
  { id: "A2 — Conversaciones simples del día a día",      emoji: "📘" },
  { id: "B1 — Hablo de temas cotidianos con fluidez",     emoji: "💬" },
  { id: "B2 — Me defiendo en contextos exigentes",        emoji: "🎯" },
  { id: "C1 — Nivel avanzado",                            emoji: "🏆" },
] as const;

const GOAL_OPTIONS = [
  { id: "Trabajo",                       emoji: "💼" },
  { id: "Estudios",                      emoji: "🎓" },
  { id: "Vida diaria / integración",     emoji: "🏠" },
  { id: "Examen oficial / ciudadanía",   emoji: "📋" },
  { id: "Crecimiento personal",          emoji: "✨" },
] as const;

const URGENCY_OPTIONS = [
  { id: "Lo antes posible (3 meses)", emoji: "🔥" },
  { id: "6 meses",                    emoji: "📅" },
  { id: "1 año",                      emoji: "🗓️" },
  { id: "Más de 1 año",               emoji: "🌿" },
  { id: "Sin fecha definida",         emoji: "🤷" },
] as const;

const BUDGET_OPTIONS = [
  { id: "Menos de 100€/mes",   emoji: "🌱", lowBudget: true  },
  { id: "100-300€/mes",        emoji: "💶", lowBudget: false },
  { id: "300-600€/mes",        emoji: "💰", lowBudget: false },
  { id: "Más de 600€/mes",     emoji: "👑", lowBudget: false },
  { id: "Estoy evaluando",     emoji: "🔍", lowBudget: false },
] as const;

// País — lista corta de los relevantes para Aprender-Aleman.de.
// Si quieres dropdown completo, swap a una lista ISO 3166-1 generada.
const COUNTRY_OPTIONS: { code: string; name: string }[] = [
  { code: "ES", name: "España" },
  { code: "DE", name: "Alemania" },
  { code: "AT", name: "Austria" },
  { code: "CH", name: "Suiza" },
  { code: "AR", name: "Argentina" },
  { code: "MX", name: "México" },
  { code: "CO", name: "Colombia" },
  { code: "CL", name: "Chile" },
  { code: "PE", name: "Perú" },
  { code: "UY", name: "Uruguay" },
  { code: "PY", name: "Paraguay" },
  { code: "BO", name: "Bolivia" },
  { code: "EC", name: "Ecuador" },
  { code: "VE", name: "Venezuela" },
  { code: "CR", name: "Costa Rica" },
  { code: "PA", name: "Panamá" },
  { code: "DO", name: "Rep. Dominicana" },
  { code: "GT", name: "Guatemala" },
  { code: "HN", name: "Honduras" },
  { code: "NI", name: "Nicaragua" },
  { code: "SV", name: "El Salvador" },
  { code: "CU", name: "Cuba" },
  { code: "PR", name: "Puerto Rico" },
  { code: "BR", name: "Brasil" },
  { code: "US", name: "Estados Unidos" },
  { code: "FR", name: "Francia" },
  { code: "IT", name: "Italia" },
  { code: "PT", name: "Portugal" },
  { code: "GB", name: "Reino Unido" },
  { code: "NL", name: "Países Bajos" },
  { code: "BE", name: "Bélgica" },
  { code: "XX", name: "Otro" },
];

// Paso 1 nuevo (Quality Score Google Ads): keywords objetivo en
// etiquetas semánticas <h1>/<h2>/<h3> del primer paint server-side.
// "otro" eliminado 2026-05-26 — convertía 0/16 (0%). Si alguien no
// encaja en estos 4, no es lead cualificado para el funnel.
const MOTIVO_OPTIONS = [
  { id: "particulares", emoji: "👨‍🏫", h3: "Clases particulares de alemán online" },
  { id: "intensivo",    emoji: "🚀", h3: "Curso intensivo de alemán online" },
  { id: "certificado",  emoji: "🏅", h3: "Cursos de alemán con certificado oficial (TELC, FIDE, Goethe)" },
  { id: "profesional",  emoji: "💼", h3: "Alemán para trabajar (profesionales)" },
] as const;

export type MotivoId = typeof MOTIVO_OPTIONS[number]["id"];

const MOTIVO_PERSONALIZED_H2: Record<MotivoId, string> = {
  particulares: "Genial 👋 Tu primera clase con un profesor nativo certificado es gratis",
  intensivo:    "Perfecto 🚀 Te preparamos un curso intensivo a tu medida",
  certificado:  "Perfecto 🏅 Te ayudamos a obtener tu certificado oficial",
  profesional:  "Perfecto 💼 Te preparamos el alemán que necesitas para tu profesión",
};

type Answers = {
  motivo:  MotivoId | null;
  level:   typeof LEVEL_OPTIONS[number]["id"]   | null;
  goal:    typeof GOAL_OPTIONS[number]["id"]    | null;
  urgency: typeof URGENCY_OPTIONS[number]["id"] | null;
  budget:  typeof BUDGET_OPTIONS[number]["id"]  | null;
};

type FormData = {
  name:         string;
  email:        string;
  whatsapp:     string;        // local digits, sin código país
  countryCode:  string;        // "+34", "+49", etc — para WhatsApp
  country:      string;        // ISO-2 país de residencia
  gdpr:         boolean;
};

// Pasos del funnel (post-2026-05-26, quiz simplificado a 2 preguntas).
//   1: motivo (Q.Score Google Ads)
//   2: nivel (MCER A0..C1)
//   3, 4, 5: ELIMINADOS del UI. Stiv hace estas preguntas (goal,
//     urgencia, budget) por WhatsApp en la conversación post-trial.
//     Mantenemos las constantes GOAL/URGENCY/BUDGET_OPTIONS y los
//     mappers porque otros componentes (admin, agendar) los siguen
//     usando. El visitante salta de paso 2 directo a paso 6 (datos).
//   6: captura de datos
//   7: resumen + calendario
// "particulares_offer" — pantalla intermedia entre paso 1 (motivo) y
// paso 2 (nivel) que aparece SÓLO cuando motivo=particulares. Muestra
// pricing transparente porque los leads de particulares abandonaban
// 75% en paso 2 esperando ver precio (vs intensivo/certificado 60%).
type Step = 1 | 2 | 3 | 4 | 5 | "low_budget_exit" | "particulares_offer" | 6 | 7;

/**
 * Combina country code + número local en E.164 protegiéndose de los
 * casos típicos en que el usuario tipea el número con el código país
 * incluido (caso real Juan José 2026-05-07: select="+34" + input="34
 * 615 541 087" → resultado "+3434615541087" que rompía Evolution).
 *
 * Reglas de saneo:
 *  1. Strip non-digits.
 *  2. Si el número empieza por "00", interpreta como prefijo internacional.
 *  3. Mientras los dígitos empiecen por el country code Y el resto sea
 *     plausible (≥6 dígitos), los strippamos. Ahora en bucle para
 *     manejar casos como "+34+34611..." (triple+ CC).
 *  4. Quita 0 inicial nacional ("0611..." en muchos países = trunk).
 *  5. Concatena `+` + ccDigits + localDigits.
 */
export function combineE164(countryCode: string, localInput: string): string {
  const ccDigits = countryCode.replace(/\D/g, "");
  let digits = (localInput ?? "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  // Loop para limpiar CC duplicados/triplicados. Cada iteración sólo
  // quita una copia y vuelve a comprobar — frena al primer fallo de
  // la condición de plausibilidad.
  if (ccDigits) {
    let guard = 4; // máx. 4 iteraciones (un humano no escribe más).
    while (guard-- > 0
           && digits.startsWith(ccDigits)
           && digits.length - ccDigits.length >= 6) {
      digits = digits.slice(ccDigits.length);
    }
  }
  if (digits.startsWith("0")) digits = digits.slice(1);
  return `+${ccDigits}${digits}`;
}

/**
 * Longitud esperada de dígitos LOCALES (sin código país) por prefijo.
 * `[min, max]` inclusivo. Si el prefijo no está mapeado usamos el
 * default amplio [7, 13].
 *
 * Datos basados en numbering plans ITU-T (E.164) de cada país.
 */
const LOCAL_DIGITS_BY_CC: Record<string, [number, number]> = {
  "+49":  [10, 12],  // Alemania móvil (152xxxxxxxx etc)
  "+34":  [9, 9],    // España siempre 9
  "+41":  [9, 9],    // Suiza
  "+43":  [10, 13],  // Austria móvil
  "+33":  [9, 9],    // Francia
  "+44":  [10, 10],  // UK móvil/fijo
  "+39":  [9, 11],   // Italia
  "+351": [9, 9],    // Portugal
  "+31":  [9, 9],    // Países Bajos
  "+32":  [8, 9],    // Bélgica
  "+54":  [10, 11],  // Argentina móvil (a veces lleva 9 extra)
  "+55":  [10, 11],  // Brasil móvil
  "+52":  [10, 10],  // México
  "+57":  [10, 10],  // Colombia
  "+56":  [8, 9],    // Chile
  "+51":  [9, 9],    // Perú
  "+58":  [10, 10],  // Venezuela
  "+598": [8, 8],    // Uruguay
  "+595": [9, 9],    // Paraguay
  "+591": [8, 8],    // Bolivia
  "+593": [9, 9],    // Ecuador
  "+506": [8, 8],    // Costa Rica
  "+507": [8, 8],    // Panamá
  "+1":   [10, 10],  // USA/Canadá/PR/DO
  "+53":  [8, 8],    // Cuba
  "+502": [8, 8],    // Guatemala
  "+503": [8, 8],    // El Salvador
  "+504": [8, 8],    // Honduras
  "+505": [8, 8],    // Nicaragua
};

/**
 * Valida que el número local (sin prefijo) tenga la longitud correcta
 * para el país del prefijo seleccionado. Devuelve `null` si OK, o un
 * mensaje legible si está mal.
 */
export function validatePhoneForCountry(
  countryCode: string,
  e164: string,
): string | null {
  const cc = countryCode.startsWith("+") ? countryCode : `+${countryCode}`;
  const range = LOCAL_DIGITS_BY_CC[cc] ?? [7, 13];
  const ccDigits = cc.replace(/\D/g, "");
  const all = e164.replace(/\D/g, "");
  if (!all.startsWith(ccDigits)) {
    return "El número no coincide con el prefijo. Revisa.";
  }
  const local = all.slice(ccDigits.length);
  if (local.length < range[0]) {
    return `El número parece muy corto. Para ${cc} debe tener ${range[0] === range[1] ? range[0] : `${range[0]}-${range[1]}`} dígitos (sin el prefijo).`;
  }
  if (local.length > range[1]) {
    return `El número parece muy largo. Para ${cc} debe tener ${range[0] === range[1] ? range[0] : `${range[0]}-${range[1]}`} dígitos (sin el prefijo).`;
  }
  return null;
}

// Nombre legible de país por prefijo telefónico (para el aviso de
// mismatch). Cubre los prefijos más comunes del tráfico.
const CC_TO_NAME: Record<string, string> = {
  "+49": "Alemania", "+34": "España", "+41": "Suiza", "+43": "Austria",
  "+33": "Francia", "+39": "Italia", "+351": "Portugal", "+44": "Reino Unido",
  "+31": "Países Bajos", "+32": "Bélgica",
  "+54": "Argentina", "+52": "México", "+57": "Colombia", "+56": "Chile",
  "+51": "Perú", "+58": "Venezuela", "+598": "Uruguay", "+595": "Paraguay",
  "+591": "Bolivia", "+593": "Ecuador", "+506": "Costa Rica", "+507": "Panamá",
  "+53": "Cuba", "+55": "Brasil", "+1": "EE.UU./Canadá",
  "+502": "Guatemala", "+503": "El Salvador", "+504": "Honduras", "+505": "Nicaragua",
};
function countryNameForCc(cc: string): string {
  return CC_TO_NAME[cc] ?? "otro país";
}

/**
 * Props para entrada desde landings dedicadas (Gelfis 2026-06-XX).
 *
 *   presetMotivo: si la landing tiene una intención inequívoca, pre-
 *     seleccionamos el motivo y saltamos el paso 1. Si la landing es
 *     genérica/ambigua, lo dejamos null y el lead lo elige.
 *
 *   landingIntent: slug estable que identifica la landing de origen
 *     ('home','curso-online','particulares','intensivo','certificado',
 *     'b2-trabajar','ciudades'). Se propaga a TODOS los trackStep
 *     + register para que /admin/ads pueda hacer breakdown por
 *     landing, separado de motivo_inicial.
 */
export type DiagnosticoFunnelProps = {
  presetMotivo?:  MotivoId | null;
  landingIntent?: string;
};

export function DiagnosticoFunnel({
  presetMotivo = null,
  landingIntent = "home",
}: DiagnosticoFunnelProps = {}) {
  // Si la landing pre-setea un motivo, arrancamos en step=2 (nivel)
  // con motivo ya poblado. Si no, flujo normal desde step=1.
  const [step, setStep]       = useState<Step>(presetMotivo ? 2 : 1);
  const [answers, setAnswers] = useState<Answers>({
    motivo: presetMotivo, level: null, goal: null, urgency: null, budget: null,
  });
  const [form, setForm] = useState<FormData>({
    // Defaults DE/+49 (Gelfis 2026-05-22). La mayoría del tráfico esperado
    // está en territorio DACH; el lead puede cambiar el país en el dropdown.
    name: "", email: "", whatsapp: "", countryCode: "+49", country: "DE", gdpr: false,
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitErr,  setSubmitErr]  = useState<string | null>(null);
  const [alreadyRegistered, setAlreadyRegistered] = useState<{ loginUrl: string } | null>(null);
  const [leadId,     setLeadId]     = useState<string | null>(null);
  const [sessionId,  setSessionId]  = useState<string | null>(null);
  // Form unificado v3 (Gelfis 2026-06-01): nombre + email obligatorios,
  // WhatsApp opcional que aparece cuando ambos están válidos.
  // emailOnly=true cuando el lead envía sin WA → step=7 muestra
  // EmailOnlyThanksScreen (book-trial requiere WA).
  const [emailOnly, setEmailOnly] = useState(false);

  // Auto-detección del prefijo país desde la TZ del navegador
  // (Gelfis 2026-06-15). Recibíamos muchos números inservibles porque el
  // lead dejaba el +49 por defecto pensando que era opcional o no veía
  // el desplegable. Ahora si el navegador reporta TZ LATAM/ES, precargamos
  // el prefijo correspondiente. El lead sigue pudiendo cambiarlo manualmente.
  // Placeholder del campo WhatsApp también se ajusta a un número típico
  // del país detectado para guiar el formato esperado.
  const [phonePlaceholder, setPhonePlaceholder] = useState("15253409644");
  useEffect(() => {
    const detected = detectCountryFromBrowser();
    if (!detected) return;
    setPhonePlaceholder(detected.examplePhone);
    setForm(f => {
      // No pisamos si el usuario ya tecleó algo distinto al default
      if (f.countryCode !== "+49" || f.country !== "DE") return f;
      return { ...f, countryCode: detected.countryCode, country: detected.country };
    });
  }, []);

  // Theme color para la barra de estado en móvil — cream/rose pastel
  // tras el redesign light-mode 2026-05-26 (estilo Preply).
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.setAttribute("name", "theme-color");
    meta.setAttribute("content", "#FFF1ED");
    meta.setAttribute("data-diagnostico", "1");
    document.head.appendChild(meta);
    return () => { meta.remove(); };
  }, []);

  // session_id persistente para enlazar la respuesta del paso 1
  // (motivo_inicial) con el lead final cuando se cree.
  useEffect(() => {
    try {
      let sid = sessionStorage.getItem("b2c.diagnostico.sid");
      if (!sid) {
        sid = (typeof crypto !== "undefined" && crypto.randomUUID)
          ? crypto.randomUUID()
          : `sid_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        sessionStorage.setItem("b2c.diagnostico.sid", sid);
      }
      setSessionId(sid);
    } catch { /* ignore */ }
  }, []);

  // Captura de atribución publicitaria (Gelfis 2026-05-27). El GCLID es
  // el ID de clic que Google añade a la URL del anuncio (?gclid=...);
  // lo necesitamos para atribuir la conversión offline (lead→cliente)
  // de vuelta a la campaña. Persistimos en sessionStorage para que
  // sobreviva la navegación del quiz. gbraid/wbraid son las variantes
  // de iOS. También guardamos UTMs para análisis interno.
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const keys = ["gclid", "gbraid", "wbraid", "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"];
      for (const k of keys) {
        const v = params.get(k);
        // Sólo escribimos si viene en la URL — no machacamos un valor
        // capturado en una visita anterior de la misma sesión.
        if (v) sessionStorage.setItem(`b2c.attr.${k}`, v);
      }
    } catch { /* ignore */ }
  }, []);

  // Progreso visual. En el flujo normal (3 pasos): motivo→nivel→datos.
  // Cuando viene de una landing con presetMotivo, paso 1 (motivo)
  // está saltado → solo 2 pasos visibles: nivel→datos.
  const totalSteps = presetMotivo ? 2 : 3;
  const visualStepNum = presetMotivo
    ? (step === 2 ? 1 : step === 6 || step === 7 || step === "low_budget_exit" ? 2 : 2)
    : (
        step === 1 ? 1 :
        step === "particulares_offer" ? 1 :
        step === 2 ? 2 :
        step === "low_budget_exit" ? 3 :
        step === 6 ? 3 :
        step === 7 ? 3 :
        3
      );
  const progressPct = (visualStepNum / totalSteps) * 100;

  // Handlers ────────────────────────────────────────────────────

  // Telemetría: graba en funnel_progress que la sesión llegó a {step}
  // y opcionalmente qué respuesta dio. Fire-and-forget, no bloquea UX.
  // Llamado al ENTRAR al paso, no al salir, para registrar abandono
  // correctamente: si el lead llega al paso 3 y se va, queda como
  // "alcanzó paso 3" sin respuesta de paso 3.
  function trackStep(stepNum: number, answer: string | null) {
    if (!sessionId) return;
    try {
      fetch("/api/public/funnel/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id:     sessionId,
          step:           stepNum,
          answer,
          landing_intent: landingIntent,
        }),
        keepalive: true,
      }).catch(() => { /* silencioso */ });
    } catch { /* silencioso */ }
  }

  async function pickMotivo(id: MotivoId) {
    setAnswers(a => ({ ...a, motivo: id }));
    // Particulares → pantalla de pricing transparente antes del quiz.
    // El resto continúa al paso 2 (nivel) directo.
    if (id === "particulares") {
      setStep("particulares_offer");
    } else {
      setStep(2);
    }
    trackStep(1, id);
    if (sessionId) {
      try {
        await fetch("/api/public/motivo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session_id:     sessionId,
            motivo:         id,
            landing_intent: landingIntent,
          }),
        });
      } catch { /* silencioso */ }
    }
  }
  function pickLevel(id: typeof LEVEL_OPTIONS[number]["id"]) {
    setAnswers(a => ({ ...a, level: id }));
    // Quiz simplificado 2026-05-26: tras el nivel saltamos directo a
    // paso 6 (captura). Goal/urgencia/budget se preguntan por WhatsApp.
    setStep(6);
    trackStep(2, id);
  }
  // Handlers heredados — ya no enganchados al UI, pero los conservamos
  // por si en el futuro re-introducimos alguna pregunta del quiz.
  function pickGoal(id: typeof GOAL_OPTIONS[number]["id"]) {
    setAnswers(a => ({ ...a, goal: id }));
    setStep(4);
    trackStep(3, id);
  }
  function pickUrgency(id: typeof URGENCY_OPTIONS[number]["id"]) {
    setAnswers(a => ({ ...a, urgency: id }));
    setStep(5);
    trackStep(4, id);
  }
  function pickBudget(id: typeof BUDGET_OPTIONS[number]["id"], lowBudget: boolean) {
    setAnswers(a => ({ ...a, budget: id }));
    setStep(lowBudget ? "low_budget_exit" : 6);
    trackStep(5, id);
  }

  function goBack() {
    if (step === 7) return;
    if (step === 6) {
      // Si llegaron al form desde particulares_offer (skip quiz),
      // vuelven a la oferta; si no, al paso 2 (nivel).
      setStep(answers.motivo === "particulares" && !answers.level
        ? "particulares_offer" : 2);
    }
    else if (step === "particulares_offer") setStep(1);
    else if (step === "low_budget_exit") setStep(5);
    else if (step === 5) setStep(4);
    else if (step === 4) setStep(3);
    else if (step === 3) setStep(2);
    else if (step === 2) {
      // Si el motivo viene PRE-SETEADO de la landing, paso 2 es el
      // primer step visible — no hay 'atrás' lógico. Bloqueamos.
      if (presetMotivo) return;
      // Si motivo=particulares (autoseleccionado en quiz), paso 2 vuelve
      // a la oferta de pricing.
      setStep(answers.motivo === "particulares" ? "particulares_offer" : 1);
    }
  }

  // Builder común del body de register. Se usa en ambas fases.
  function buildRegisterBody(whatsappE164: string | null) {
    const attr = (k: string): string | undefined => {
      try { return sessionStorage.getItem(`b2c.attr.${k}`) ?? undefined; }
      catch { return undefined; }
    };
    return {
      name:           form.name.trim(),
      email:          form.email.trim().toLowerCase(),
      whatsapp_e164:  whatsappE164,
      country:        null as string | null,
      language:       "es",
      gdpr_accepted:  true,
      session_id:     sessionId ?? undefined,
      motivo_inicial: answers.motivo ?? undefined,
      landing_intent: landingIntent,
      gclid:          attr("gclid"),
      gbraid:         attr("gbraid"),
      wbraid:         attr("wbraid"),
      utm_source:     attr("utm_source"),
      utm_medium:     attr("utm_medium"),
      utm_campaign:   attr("utm_campaign"),
      utm_term:       attr("utm_term"),
      utm_content:    attr("utm_content"),
      answers: {
        level:   answers.level,
        goal:    answers.goal,
        urgency: answers.urgency,
        budget:  answers.budget,
      },
    };
  }

  // Form unificado (Gelfis 2026-06-01 v3): nombre + email obligatorios.
  // WhatsApp OPCIONAL — aparece bajo email cuando ambos están válidos.
  // Si el lead lo deja vacío, va al drip email-only agresivo; si lo
  // llena, agenda la clase normalmente.
  async function submitData() {
    if (submitting) return;

    trackStep(5, "submit_attempt");

    const nameOk  = form.name.trim().length >= 2;
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim());
    if (!nameOk) {
      trackStep(5, "client_invalid_name");
      setSubmitErr("Pon tu nombre completo (mínimo 2 caracteres).");
      return;
    }
    if (!emailOk) {
      trackStep(5, "client_invalid_email");
      setSubmitErr("Email inválido — revisa que tenga @ y dominio.");
      return;
    }

    // WhatsApp es OPCIONAL. Sólo lo validamos si el lead lo escribió.
    let e164: string | null = null;
    const hasPhone = form.whatsapp.replace(/\D/g, "").length > 0;
    if (hasPhone) {
      const phoneRes = resolvePhone(form.countryCode, form.whatsapp);
      if (!phoneRes.valid) {
        trackStep(5, "client_invalid_phone");
        setSubmitErr("Número de WhatsApp no válido. Si no quieres darlo, déjalo vacío.");
        return;
      }
      e164 = phoneRes.e164;
    }

    setSubmitting(true);
    setSubmitErr(null);
    try {
      const whatsappE164 = e164;
      const body = buildRegisterBody(whatsappE164);

      let res: Response;
      try {
        res = await fetch("/api/public/diagnostico/register", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify(body),
        });
      } catch {
        trackStep(5, "network_error");
        setSubmitErr("No tenemos conexión. Revisa tu internet e inténtalo de nuevo.");
        setSubmitting(false);
        return;
      }

      let json: { ok?: boolean; error?: string; login_url?: string; lead_id?: string; issues?: Array<{ path?: string[]; message?: string }> } = {};
      try {
        json = await res.json();
      } catch {
        trackStep(5, "server_bad_response");
        setSubmitErr("Respuesta inesperada del servidor. Inténtalo en unos segundos.");
        setSubmitting(false);
        return;
      }
      if (res.status === 409 && json.error === "already_registered") {
        trackStep(5, "already_registered");
        setAlreadyRegistered({ loginUrl: json.login_url ?? "/login" });
        setSubmitting(false);
        return;
      }
      if (res.status === 429) {
        trackStep(5, "rate_limited");
        setSubmitErr("Demasiados intentos desde tu IP. Espera 10 minutos e inténtalo de nuevo.");
        setSubmitting(false);
        return;
      }
      if (!res.ok || !json.ok) {
        // Traducción de errores de zod (validation_failed) a mensajes
        // humanos. El backend devuelve issues[].path indicando qué
        // campo falló.
        if (json.error === "validation_failed" && Array.isArray(json.issues)) {
          const firstIssue = json.issues[0];
          const path = (firstIssue?.path ?? []).join(".");
          trackStep(5, `server_validation_${path || "unknown"}`);
          const fieldErrors: Record<string, string> = {
            email:         "Email inválido — revisa que tenga @ y dominio.",
            name:          "Pon tu nombre completo (mínimo 2 caracteres).",
            whatsapp_e164: "Número de WhatsApp inválido. Revisa el prefijo y los dígitos.",
            "answers.level": "Selecciona tu nivel en el paso anterior.",
            motivo_inicial: "Vuelve al paso 1 y elige una opción.",
          };
          setSubmitErr(fieldErrors[path] ?? firstIssue?.message ?? "Datos inválidos. Revísalos.");
        } else {
          trackStep(5, `server_5xx_${res.status}`);
          setSubmitErr("No pudimos guardar tu plan. Inténtalo en unos segundos o escríbenos por WhatsApp.");
        }
        setSubmitting(false);
        return;
      }

      // En este punto json.ok===true por el guard de arriba — pero TS
      // no lo infiere por el shape inline. Sacamos lead_id con guard.
      const newLeadId = json.lead_id ?? "";
      if (!newLeadId) {
        setSubmitErr("Respuesta inesperada del servidor. Inténtalo en unos segundos.");
        setSubmitting(false);
        return;
      }

      // Telemetría: paso 6 completado (form de datos enviado).
      trackStep(6, null);

      // Lead guardado. Disparar pixels y avanzar al resumen.
      // hasWhatsapp señaliza calidad del lead a Google Ads / Meta /
      // TikTok: con WhatsApp = 2 EUR (puede agendar); sin = 1 EUR.
      firePixelLead({
        leadId:      newLeadId,
        email:       body.email,
        budget:      body.answers.budget,
        hasWhatsapp: !!e164,
      });

      // Pre-cargar el booking-state que usa `/agendar/*` para que el
      // siguiente paso (slot picker) tenga toda la info y NO le pida
      // al lead que reescriba nombre, email, teléfono, nivel y
      // objetivo. La flag `from_diagnostico=true` le dice a la
      // página `/agendar/cuando` que tras escoger horario haga submit
      // directo a /api/public/book-trial sin pasar por /tu /nivel
      // /objetivo.
      const levelMap: Record<string, "A0" | "A1" | "A2" | "B1" | "B2" | "C1"> = {
        "A0 — Cero, no sé nada":                          "A0",
        "A1 — Conozco lo básico (saludos, números)":      "A1",
        "A2 — Conversaciones simples del día a día":      "A2",
        "B1 — Hablo de temas cotidianos con fluidez":     "B1",
        "B2 — Me defiendo en contextos exigentes":        "B2",
        "C1 — Nivel avanzado":                            "C1",
      };
      const goalMap: Record<string, "work" | "studies" | "already_in_dach" | "exam" | "travel"> = {
        "Trabajo":                       "work",
        "Estudios":                      "studies",
        "Vida diaria / integración":     "already_in_dach",
        "Examen oficial / ciudadanía":   "exam",
        "Crecimiento personal":          "travel",
      };
      const bookingState = {
        slot_iso:         null,
        teacher_id:       null,
        teacher_name:     null,
        name:             form.name.trim(),
        email:            body.email,
        german_level:     answers.level    ? levelMap[answers.level] : null,
        goal:             answers.goal     ? goalMap [answers.goal]  : null,
        country_code:     form.countryCode.startsWith("+") ? form.countryCode : `+${form.countryCode}`,
        phone_local:      form.whatsapp,
        from_diagnostico: true,
        lead_id:          newLeadId,
        savedAt:          Date.now(),
      };
      try {
        sessionStorage.setItem("b2c.agendar.v1", JSON.stringify(bookingState));
        // Backwards-compat keys (por si algo los leía).
        sessionStorage.setItem("diagnostico_lead_id", newLeadId);
        sessionStorage.setItem("diagnostico_name",    form.name.trim());
        sessionStorage.setItem("diagnostico_email",   body.email);
      } catch { /* ignore */ }

      setLeadId(newLeadId);
      // Decisión Gelfis 2026-06-XX: el calendario se despliega INLINE
      // dentro de DataCaptureStep (step=5) en cuanto leadId está set.
      // Cero navegación a step=7 — el lead siente que el calendario
      // "apareció" debajo del form colapsado. Hace ratio submit→book
      // mejor porque elimina la fricción del click intermedio.
      // Conservamos los eventos de telemetría para medir el ratio.
      if (!whatsappE164) {
        trackStep(5, "submitted_email_only");
      } else {
        trackStep(5, "submitted_with_whatsapp");
      }
      // setStep(7) eliminado — DataCaptureStep ya renderiza CalendarStep
      // inline al detectar leadId !== null. Auto-scroll suave hacia el
      // calendario para que se vea de inmediato.
      setTimeout(() => {
        if (typeof window !== "undefined") {
          window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
        }
      }, 100);
    } catch (e) {
      console.error("[diagnostico] submit failed:", e);
      setSubmitErr("Error de conexión. Inténtalo de nuevo.");
      setSubmitting(false);
    }
  }

  // ── Render ──────────────────────────────────────────────────

  // Mapeo paso → key de ilustración. Pasos 3/4/5 ya no se muestran al
  // usuario (quiz simplificado a motivo+nivel) pero los mantenemos por
  // compat de tipos.
  const illustrationKey =
    step === 1 ? "motivo" :
    step === 2 ? "nivel" :
    step === 6 ? "datos" :
    step === 7 ? "calendario" :
    step === "low_budget_exit" ? "low_budget" :
    step === "particulares_offer" ? "particulares" :
    "motivo";

  return (
    <div className="min-h-[100dvh] bg-white text-slate-900 flex flex-col"
         style={{ overscrollBehavior: "contain" }}>

      {/* ═══ Header full-width — FUERA del IllustrationPanel para que
          ocupe los dos paneles a la vez. Antes vivía dentro del panel
          derecho y la imagen lo cortaba en desktop a partir del paso 1
          (Gelfis 2026-06-14). Sticky en su posición. ═══ */}
      <header
        className="sticky top-0 z-40 backdrop-blur bg-white/95 border-b border-slate-100 w-full"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <div className="mx-auto max-w-xl flex items-center justify-between gap-2 h-14 md:h-16 px-4">
          <button
            type="button"
            onClick={goBack}
            disabled={step === 1 || step === 7}
            className="h-10 w-10 inline-flex items-center justify-center rounded-full
                       text-slate-700 hover:bg-slate-100 active:scale-95 transition
                       disabled:opacity-30 disabled:active:scale-100"
            aria-label="Paso anterior"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>

          <BrandLogo size="md" />

          <div className="h-10 w-10 inline-flex items-center justify-end pr-1">
            {step !== "low_budget_exit" && step !== 7 && (
              <span className="text-[11px] font-semibold tracking-wide text-slate-500 tabular-nums">
                {visualStepNum}/{totalSteps}
              </span>
            )}
          </div>
        </div>
        <div className="h-1 bg-slate-100">
          <div
            className="h-full bg-warm transition-[width] duration-300 ease-out"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </header>

      {/* ═══ Cuerpo: IllustrationPanel BAJO el header. flex-1 para
          rellenar lo que queda del viewport. ═══ */}
      <div className="flex-1 flex">
      <IllustrationPanel step={illustrationKey}>
        <div className="flex flex-col w-full">

          {/* Prueba social — sólo en pasos del quiz (1, 2) y del form (6). */}
          {(step === 1 || step === 2 || step === 6) && (
            <div className="mx-auto w-full max-w-xl px-5 pt-3">
              <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11px] sm:text-xs text-slate-500 leading-snug">
                <span className="flex items-center gap-1">
                  <span className="text-amber-500">⭐⭐⭐⭐⭐</span>
                  <span>+800 estudiantes activos</span>
                </span>
                <span className="hidden sm:inline text-slate-300">·</span>
                <span>💬 Respuesta en &lt;5 min</span>
                <span className="hidden sm:inline text-slate-300">·</span>
                <span>🗺️ Profesores nativos certificados</span>
              </div>
            </div>
          )}

          <main className="flex-1 mx-auto w-full max-w-xl">
        {step === 1 && (
          <MotivoInicialStep
            selected={answers.motivo}
            onPick={pickMotivo}
          />
        )}
        {step === "particulares_offer" && (
          <ParticularesOfferStep
            onContinueQuiz={() => { setStep(2); trackStep(2, "from_particulares_offer_quiz"); }}
            onSkipToForm={() => { setStep(6); trackStep(2, "from_particulares_offer_skip"); }}
          />
        )}
        {step === 2 && (
          <QuizStep
            title="¿Cuál es tu nivel actual de alemán?"
            personalizedH2={answers.motivo ? MOTIVO_PERSONALIZED_H2[answers.motivo] : null}
            options={LEVEL_OPTIONS.map(o => ({ id: o.id, label: o.id, emoji: o.emoji }))}
            selected={answers.level}
            onPick={(id) => pickLevel(id as typeof LEVEL_OPTIONS[number]["id"])}
          />
        )}
        {step === 3 && (
          <QuizStep
            title="¿Para qué necesitas el alemán?"
            options={GOAL_OPTIONS.map(o => ({ id: o.id, label: o.id, emoji: o.emoji }))}
            selected={answers.goal}
            onPick={(id) => pickGoal(id as typeof GOAL_OPTIONS[number]["id"])}
          />
        )}
        {step === 4 && (
          <QuizStep
            title="¿En cuánto tiempo quieres alcanzar tu objetivo?"
            options={URGENCY_OPTIONS.map(o => ({ id: o.id, label: o.id, emoji: o.emoji }))}
            selected={answers.urgency}
            onPick={(id) => pickUrgency(id as typeof URGENCY_OPTIONS[number]["id"])}
          />
        )}
        {step === 5 && (
          <QuizStep
            title="¿Cuánto puedes invertir mensualmente en aprender alemán?"
            options={BUDGET_OPTIONS.map(o => ({ id: o.id, label: o.id, emoji: o.emoji }))}
            selected={answers.budget}
            onPick={(id) => {
              const opt = BUDGET_OPTIONS.find(o => o.id === id);
              pickBudget(id as typeof BUDGET_OPTIONS[number]["id"], opt?.lowBudget ?? false);
            }}
          />
        )}
        {step === "low_budget_exit" && <LowBudgetExit onBack={() => setStep(5)} />}
        {step === 6 && (
          alreadyRegistered ? (
            <AlreadyRegisteredScreen
              loginUrl={alreadyRegistered.loginUrl}
              onBack={() => { setAlreadyRegistered(null); setForm(f => ({ ...f, email: "" })); }}
            />
          ) : (
            <DataCaptureStep
              form={form}
              setForm={setForm}
              submitting={submitting}
              submitErr={submitErr}
              phonePlaceholder={phonePlaceholder}
              onSubmit={submitData}
              onMicroEvent={(e) => {
                if (e === "form_opened") trackStep(3, "form_opened");
                else if (e === "field_typed") trackStep(4, "field_typed");
              }}
              leadId={leadId}
              answers={answers}
              name={form.name.trim().split(/\s+/)[0] || "tú"}
            />
          )
        )}
        {step === 7 && leadId && emailOnly && (
          <EmailOnlyThanksScreen
            name={form.name.trim().split(/\s+/)[0] || "tú"}
            email={form.email.trim()}
            onScheduleClick={() => setEmailOnly(false)}
          />
        )}
        {step === 7 && leadId && !emailOnly && (
          <CalendarStep
            name={form.name.trim().split(/\s+/)[0] || "tú"}
            answers={answers}
            form={form}
            leadId={leadId}
          />
        )}
          </main>
        </div>
      </IllustrationPanel>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Sub-componentes
// ────────────────────────────────────────────────────────────────

/**
 * Paso 1 nuevo (Quality Score Google Ads).
 *
 * Render con etiquetas semánticas estrictas — H1, H2, ULRadiogroup,
 * <button> con <h3> dentro. NO depende de cookies, fetch, animaciones
 * retardadas ni user gestures: el primer paint server-side ya contiene
 * los textos-keyword en el HTML que devuelve el servidor.
 *
 * Above-the-fold en móviles 375px: H1 (compacto) + H2 + 5 opciones
 * compactas caben sin scroll porque cada opción es ~52px y dejamos
 * mínima separación. El click del botón llama a onPick, que persiste
 * en BD via /api/public/motivo y avanza al paso 2.
 */
function MotivoInicialStep({
  selected, onPick,
}: {
  selected: MotivoId | null;
  onPick: (id: MotivoId) => void;
}) {
  return (
    <div className="px-5 md:px-8 lg:px-10 pt-5 md:pt-9 lg:pt-12 pb-10 md:pb-16">
      {/* Layout estilo Preply (2026-05-26): título alineado a la
          izquierda, no centrado. La ilustración va en el panel
          adyacente (IllustrationPanel), no necesitamos hero grande
          aquí — basta con la pregunta principal directa. */}
      <h2
        id="motivo-inicial-question"
        className="text-[22px] sm:text-2xl md:text-[24px] lg:text-[28px] font-extrabold tracking-tight text-slate-900 leading-tight"
      >
        ¿Qué tipo de clases de alemán buscas?
      </h2>
      <p className="mt-2 text-[14px] md:text-base text-slate-600 leading-snug">
        Te ayudamos a aprender alemán con profesores nativos certificados.
      </p>
      {/* Margen extra entre la pregunta y las opciones (mt-7 mobile,
          mt-10 desktop) — antes mt-4. */}
      <ul
        role="radiogroup"
        aria-labelledby="motivo-inicial-question"
        className="mt-7 md:mt-9 space-y-2 md:space-y-3"
      >
        {MOTIVO_OPTIONS.map(opt => {
          const isSelected = selected === opt.id;
          return (
            <li key={opt.id}>
              <button
                type="button"
                role="radio"
                aria-checked={isSelected}
                data-choice={opt.id}
                onClick={() => onPick(opt.id)}
                className={`w-full flex items-center gap-3 md:gap-4 px-4 md:px-5 min-h-[52px] md:min-h-[64px] lg:min-h-[72px] py-2 md:py-3 rounded-2xl
                            text-left text-slate-900
                            border transition active:scale-[0.99]
                            ${isSelected
                              ? "border-warm bg-warm/10"
                              : "border-slate-200 bg-slate-50 hover:bg-slate-100"}`}
              >
                <span className="text-[22px] sm:text-xl md:text-2xl leading-none shrink-0" aria-hidden>
                  {opt.emoji}
                </span>
                {/* +10% en móvil (text-[15.5px] vs antes 14) */}
                <h3 className="text-[15.5px] sm:text-[15px] md:text-[15px] lg:text-[16px] leading-snug font-medium m-0">
                  {opt.h3}
                </h3>
              </button>
            </li>
          );
        })}
      </ul>
      {/* Badge de recompensa — DEBAJO de las opciones para no competir
          visualmente con el título y para que el lead lo vea como
          un beneficio que rodea su decisión, no que la apura. */}
      <div className="mt-6 flex">
        <div className="inline-flex items-center gap-1.5 rounded-full bg-warm/15 text-warm-foreground
                        px-3 py-1 text-[12px] font-semibold">
          <span aria-hidden>🎁</span>
          <span>Al terminar te llevas tu <strong>clase de prueba GRATIS</strong></span>
        </div>
      </div>
    </div>
  );
}

/**
 * Pantalla intermedia para motivo='particulares' (Gelfis 2026-06-01).
 * Aparece entre paso 1 y paso 2 SÓLO cuando el lead eligió "Clases
 * particulares". Muestra pricing transparente porque los leads de
 * particulares abandonaban un 75% en paso 2 esperando ver precio.
 */
function ParticularesOfferStep({
  onContinueQuiz,
  onSkipToForm,
}: {
  onContinueQuiz: () => void;
  onSkipToForm:   () => void;
}) {
  return (
    <div className="px-5 md:px-8 lg:px-10 pt-5 md:pt-9 lg:pt-12 pb-12 md:pb-16">
      <h1 className="text-[24px] sm:text-3xl md:text-[28px] lg:text-[32px] font-extrabold tracking-tight text-slate-900 leading-tight">
        👨‍🏫 Clases particulares de alemán
      </h1>
      <p className="mt-3 md:mt-4 text-[15px] md:text-[15px] lg:text-[16px] text-slate-600 leading-relaxed">
        Profesor nativo certificado, online, a tu ritmo, sin compromiso.
      </p>

      {/* Tarjeta de pricing — transparencia que es lo que el lead busca */}
      <div className="mt-6 md:mt-8 rounded-2xl border-2 border-amber-300 bg-amber-50 p-5 md:p-6 space-y-3">
        <div className="flex items-start gap-3">
          <span className="text-2xl leading-none mt-0.5" aria-hidden>💎</span>
          <div>
            <p className="text-[12px] font-bold uppercase tracking-wider text-amber-900">
              Primera clase
            </p>
            <p className="mt-0.5 text-[16px] md:text-[17px] font-bold text-amber-900 leading-snug">
              GRATIS · 30 min con tu profesor nativo
            </p>
          </div>
        </div>
        <div className="flex items-start gap-3 pt-2 border-t border-amber-200">
          <span className="text-2xl leading-none mt-0.5" aria-hidden>💶</span>
          <div>
            <p className="text-[12px] font-bold uppercase tracking-wider text-amber-900">
              Después
            </p>
            <p className="mt-0.5 text-[16px] md:text-[17px] font-bold text-amber-900 leading-snug">
              Desde 18 €/clase
            </p>
            <p className="text-[12.5px] text-amber-800 mt-0.5 leading-snug">
              Paquetes flexibles · sin mensualidades · sin permanencia
            </p>
          </div>
        </div>
        <div className="flex items-start gap-3 pt-2 border-t border-amber-200">
          <span className="text-2xl leading-none mt-0.5" aria-hidden>🇩🇪</span>
          <div>
            <p className="text-[13.5px] md:text-[14px] text-amber-900 leading-snug">
              Profesores <strong>nativos certificados</strong>, todos con titulación
              oficial. Tú eliges el horario cada semana.
            </p>
          </div>
        </div>
      </div>

      {/* CTA principal: continuar al quiz (30s) */}
      <button
        type="button"
        onClick={onContinueQuiz}
        className="mt-7 md:mt-8 w-full h-12 md:h-13 lg:h-14 rounded-2xl bg-warm text-warm-foreground
                   font-semibold text-base md:text-[16px] lg:text-[17px]
                   shadow-lg shadow-warm/20 active:scale-[0.98] transition
                   flex items-center justify-center gap-2"
      >
        Personalizar mi clase
        <span className="text-[12px] font-normal opacity-75">(30 s)</span>
      </button>

      {/* CTA secundario: ir directo al form */}
      <button
        type="button"
        onClick={onSkipToForm}
        className="mt-3 w-full text-center text-[13px] md:text-[14px] text-slate-500 hover:text-slate-700 underline underline-offset-2"
      >
        O ir directo al formulario y agendar →
      </button>

      {/* Mini prueba social */}
      <p className="mt-6 md:mt-8 text-center text-[12px] text-slate-500">
        ⭐⭐⭐⭐⭐ +800 estudiantes este mes
      </p>
    </div>
  );
}

function QuizStep({
  title, options, selected, onPick, personalizedH2,
}: {
  title: string;
  options: { id: string; label: string; emoji: string }[];
  selected: string | null;
  onPick: (id: string) => void;
  personalizedH2?: string | null;
}) {
  return (
    <div className="px-5 md:px-8 lg:px-10 pt-6 md:pt-9 lg:pt-12 pb-12 md:pb-16">
      {personalizedH2 && (
        <h2 className="mb-4 md:mb-5 text-[18px] sm:text-xl md:text-[21px] lg:text-[24px] font-semibold text-warm leading-snug">
          {personalizedH2}
        </h2>
      )}
      <h1 className="text-[26px] sm:text-3xl md:text-[30px] lg:text-[36px] font-extrabold tracking-tight text-slate-900">
        {title}
      </h1>
      <ul className="mt-6 md:mt-8 space-y-3 md:space-y-4">
        {options.map(opt => {
          const isSelected = selected === opt.id;
          return (
            <li key={opt.id}>
              <button
                type="button"
                onClick={() => onPick(opt.id)}
                className={`w-full flex items-center gap-3 md:gap-4 px-4 md:px-5 h-16 md:h-[72px] lg:h-20 rounded-2xl
                            text-left text-slate-900 font-medium
                            border transition active:scale-[0.99]
                            ${isSelected
                              ? "border-warm bg-warm/10"
                              : "border-slate-200 bg-slate-50 hover:bg-slate-100"}`}
              >
                <span className="text-2xl md:text-3xl" aria-hidden>{opt.emoji}</span>
                <span className="text-[15px] md:text-[15px] lg:text-[16px] leading-snug">{opt.label}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {/* Badge de recompensa — DEBAJO de las opciones (Gelfis 2026-06-XX). */}
      <div className="mt-6 flex">
        <div className="inline-flex items-center gap-1.5 rounded-full bg-warm/15 text-warm-foreground
                        px-3 py-1 text-[12px] font-semibold">
          <span aria-hidden>🎁</span>
          <span>Al terminar te llevas tu <strong>clase de prueba GRATIS</strong></span>
        </div>
      </div>
    </div>
  );
}

function LowBudgetExit({ onBack }: { onBack: () => void }) {
  return (
    <div className="px-5 md:px-8 pt-8 md:pt-12 lg:pt-16 pb-12 md:pb-16">
      <h1 className="text-[26px] sm:text-3xl md:text-[30px] lg:text-[36px] font-extrabold tracking-tight text-slate-900">
        Gracias por contarnos tu situación
      </h1>
      <p className="mt-4 text-[15px] md:text-[15px] lg:text-[16px] text-slate-700 leading-relaxed">
        Nuestras clases con profesores empiezan desde 285€/mes, así que probablemente
        no encajemos con tu momento actual. Pero no te quedes sin avanzar — empieza
        con Schule, nuestra plataforma de auto-estudio impulsada por IA.
      </p>

      <div className="mt-7 rounded-2xl border border-slate-200 bg-slate-50 p-5">
        <div className="text-[13px] font-semibold uppercase tracking-[0.16em] text-warm">
          ✨ Empieza con Schule
        </div>
        <p className="mt-2 text-[14px] text-slate-600 leading-relaxed">
          Plataforma de auto-estudio con ejercicios de gramática, lectura, escritura
          y conversación + Hans, tu profesor digital con IA 24/7.
        </p>
      </div>

      <a
        href="https://schule.aprender-aleman.de"
        className="mt-6 block w-full text-center h-12 rounded-2xl bg-warm text-warm-foreground
                   font-semibold text-base shadow-lg shadow-warm/20 active:scale-[0.98] transition
                   leading-[3rem]"
      >
        Conocer Schule
      </a>

      <button
        type="button"
        onClick={onBack}
        className="mt-3 block w-full text-center h-12 rounded-2xl
                   border border-slate-300 text-slate-700 font-medium
                   active:scale-[0.98] transition"
      >
        ← Cambiar mi presupuesto
      </button>
    </div>
  );
}

function DataCaptureStep({
  form, setForm, submitting, submitErr, phonePlaceholder, onSubmit, onMicroEvent,
  leadId, answers, name,
}: {
  form:        FormData;
  setForm:     React.Dispatch<React.SetStateAction<FormData>>;
  submitting:  boolean;
  submitErr:   string | null;
  phonePlaceholder: string;
  onSubmit:    () => void;
  onMicroEvent?: (event: "form_opened" | "field_typed") => void;
  // Cuando leadId está set (post-register), el formulario se contrae y
  // CalendarStep se renderiza inline debajo — sin navegación a otra
  // pantalla. Política Gelfis 2026-06-XX: cero clicks intermedios.
  leadId:    string | null;
  answers:   Answers;
  name:      string;
}) {
  // Disparar "form_opened" una vez al montar.
  useEffect(() => { onMicroEvent?.("form_opened"); }, [onMicroEvent]);
  // Disparar "field_typed" la PRIMERA vez que cualquier campo cambia.
  const [typedOnce, setTypedOnce] = useState(false);
  useEffect(() => {
    if (typedOnce) return;
    const any = form.name.length > 0 || form.email.length > 0 || form.whatsapp.length > 0;
    if (any) {
      setTypedOnce(true);
      onMicroEvent?.("field_typed");
    }
  }, [form.name, form.email, form.whatsapp, typedOnce, onMicroEvent]);
  // Paso 5 v4 (Gelfis 2026-05-26):
  //  - WhatsApp PRIMERO (es el canal principal — los leads no abren email).
  //  - Email OBLIGATORIO (revertido — necesitamos backup channel).
  //  - Sin dropdown país (derivado server-side del prefijo).
  //  - Sin checkbox GDPR (aceptación implícita con disclaimer en el CTA).
  //  - Validación de longitud de teléfono por país (ES=9 dígitos,
  //    DE=10-12, etc) para evitar números mal pegados.
  const emailValid   = useMemo(
    () => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()),
    [form.email],
  );
  // Resolución inteligente del teléfono con libphonenumber. Detecta
  // el país real del número (no sólo la longitud) y avisa cuando el
  // prefijo tecleado no coincide con el del dropdown.
  const phoneInfo = useMemo(() => {
    const digits = form.whatsapp.replace(/\D/g, "");
    if (digits.length === 0) return { state: "empty" as const };
    if (digits.length < 6) return { state: "short" as const };
    const res = resolvePhone(form.countryCode, form.whatsapp);
    if (res.ccMismatch && res.detectedCc) {
      // El número parece de otro país (caso +49 seleccionado pero el
      // lead tecleó su número español). Lo aceptamos pero avisamos.
      return { state: "mismatch" as const, detectedCc: res.detectedCc, country: res.country, e164: res.e164 };
    }
    if (!res.valid) return { state: "invalid" as const };
    return { state: "ok" as const, e164: res.e164 };
  }, [form.countryCode, form.whatsapp]);

  // Mensaje de error/aviso a mostrar bajo el campo.
  const phoneError =
    phoneInfo.state === "short"    ? "El número parece muy corto."
    : phoneInfo.state === "invalid" ? "Número no válido para este prefijo. Revisa el código de país y los dígitos."
    : null;
  const phoneMismatch = phoneInfo.state === "mismatch" ? phoneInfo : null;

  const phoneDigits  = form.whatsapp.replace(/\D/g, "");
  // Form: nombre + email + WhatsApp son TODOS obligatorios desde
  // 2026-06-XX (Gelfis: WA obligatorio para clase de prueba, demasiados
  // leads sin canal de contacto). El WhatsApp aparece bajo el email
  // cuando ambos están válidos (revelación progresiva).
  const nameOk  = form.name.trim().length >= 2;
  const showWhatsappField = nameOk && emailValid;
  const phoneOk = phoneInfo.state === "ok" || phoneInfo.state === "mismatch";
  const canSubmit = !submitting && nameOk && emailValid && phoneOk;

  // Una vez registered (leadId set), pintamos el calendario inline
  // debajo del form colapsado. El usuario no ve un step nuevo —
  // siente que "el calendario apareció".
  const registered = !!leadId;

  return (
    <div className={`px-5 md:px-8 pt-6 md:pt-10 ${registered
      ? "pb-12"
      : "pb-[calc(env(safe-area-inset-bottom)+5.5rem)] md:pb-[calc(env(safe-area-inset-bottom)+7rem)]"}`}>
      {/* Cuando ya está registrado, NO mostramos el badge/h1/subtitle
          aquí — CalendarStep abajo trae su propio título y copy. Antes
          se repetía '¡Casi listo!' + 'Elige el horario...' + resumen,
          y ese pellizco duplicado se sentía bug. */}
      {!registered && (
        <>
          <div className="inline-flex items-center gap-1.5 rounded-full bg-warm/15 text-warm-foreground
                          px-3 py-1 text-[12px] font-semibold">
            <span aria-hidden>🎁</span>
            <span>Al terminar te llevas tu <strong>clase de prueba GRATIS</strong></span>
          </div>
          <h1 className="mt-3 text-[26px] sm:text-3xl md:text-[30px] lg:text-[36px] font-extrabold tracking-tight text-slate-900 leading-tight">
            ¡Estamos creando tu plan!
          </h1>
          <p className="mt-3 md:mt-4 text-[15px] md:text-[15px] lg:text-[16px] text-slate-600 leading-relaxed">
            Necesitamos unos datos para enviarte tu plan y desbloquear el calendario.
          </p>
        </>
      )}

      {/* === ZONA FORMULARIO — visible siempre, pero los inputs
          se vuelven readOnly cuando ya está registrado === */}
      {!registered && (
      <>
      <p className="mt-1 text-[11.5px] text-slate-400 leading-snug">
        Los campos marcados con <span className="text-warm font-semibold">*</span> son obligatorios.
      </p>

      <div className="mt-7 md:mt-9 space-y-5 md:space-y-6">
        <Field label={<span>Nombre <span className="text-warm">*</span></span>}>
          <input
            type="text"
            autoComplete="name"
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            className="w-full h-12 md:h-13 px-4 md:text-base lg:text-[16px] rounded-xl bg-slate-50 border border-slate-200
                       text-slate-900 placeholder:text-slate-400
                       focus:outline-none focus:border-warm focus:bg-slate-100"
            placeholder="Tu nombre y apellido"
          />
        </Field>

        {/* Email — siempre visible, obligatorio */}
        <Field label={<span>Email <span className="text-warm">*</span></span>}>
          <input
            type="email"
            autoComplete="email"
            value={form.email}
            onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
            className={`w-full h-12 md:h-13 px-4 md:text-[15px] lg:text-[16px] rounded-xl bg-slate-50 border
                       text-slate-900 placeholder:text-slate-400
                       focus:outline-none focus:bg-slate-100 ${
                         form.email.length > 0 && !emailValid
                           ? "border-red-400 focus:border-red-500"
                           : "border-slate-200 focus:border-warm"
                       }`}
            placeholder="tu@email.com"
            aria-invalid={form.email.length > 0 && !emailValid}
          />
          {form.email.length > 0 && !emailValid && (
            <p className="mt-1.5 text-[12px] text-red-600 leading-snug">
              ⚠️ Revisa el email — falta el @ o el dominio.
            </p>
          )}
          <p className="mt-1.5 text-[11.5px] text-slate-500 leading-snug">
            Aquí te enviamos el plan personalizado, materiales y la confirmación de la clase.
          </p>
        </Field>

        {/* WhatsApp — OBLIGATORIO. Aparece bajo email cuando nombre +
            email están válidos. Instrucciones explícitas porque
            estábamos recibiendo muchos números inservibles. */}
        {showWhatsappField && (
        <Field label={<span>WhatsApp <span className="text-warm">*</span></span>}>
          <div className="flex gap-2">
            <input
              type="tel"
              inputMode="tel"
              value={form.countryCode}
              onChange={e => setForm(f => ({ ...f, countryCode: e.target.value.replace(/[^0-9+]/g, "") }))}
              className="w-20 md:w-24 h-12 md:h-13 px-3 md:text-[15px] lg:text-[16px] rounded-xl bg-slate-50 border border-slate-200
                         text-slate-900 text-center
                         focus:outline-none focus:border-warm focus:bg-slate-100"
              placeholder="+49"
            />
            <input
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={form.whatsapp}
              onChange={e => setForm(f => ({ ...f, whatsapp: e.target.value }))}
              className={`flex-1 h-12 md:h-13 px-4 md:text-[15px] lg:text-[16px] rounded-xl bg-slate-50 border
                         text-slate-900 placeholder:text-slate-400
                         focus:outline-none focus:bg-slate-100 ${
                           phoneError
                             ? "border-red-400 focus:border-red-500"
                             : "border-slate-200 focus:border-warm"
                         }`}
              placeholder={phonePlaceholder}
              aria-invalid={!!phoneError}
              aria-describedby={phoneError ? "wa-error" : undefined}
            />
          </div>
          {phoneError && (
            <p id="wa-error" className="mt-1.5 text-[12px] text-red-600 leading-snug">
              ⚠️ {phoneError}
            </p>
          )}
          {phoneInfo.state === "ok" && (
            <p className="mt-1.5 text-[12px] text-emerald-700 font-semibold leading-snug">
              ✓ Número válido — listo para confirmar
            </p>
          )}
          {phoneMismatch && (
            <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2">
              <p className="text-[12px] text-amber-900 leading-snug">
                ⚠️ Tu número parece de <strong>{countryNameForCc(phoneMismatch.detectedCc)}</strong> ({phoneMismatch.detectedCc}),
                pero seleccionaste {form.countryCode}.
              </p>
              <button
                type="button"
                onClick={() => {
                  const det = phoneMismatch.detectedCc!;
                  const detDigits = det.replace(/\D/g, "");
                  let local = form.whatsapp.replace(/\D/g, "");
                  if (local.startsWith(detDigits)) local = local.slice(detDigits.length);
                  setForm(f => ({ ...f, countryCode: det, whatsapp: local }));
                }}
                className="mt-1.5 text-[12px] font-semibold text-amber-900 underline underline-offset-2"
              >
                Cambiar prefijo a {phoneMismatch.detectedCc} →
              </button>
            </div>
          )}
          <p className="mt-2 text-[12px] text-slate-500 leading-snug">
            Te contactaremos solo con <strong>fines educativos</strong>.
          </p>
        </Field>
        )}

        {submitErr && (
          <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {submitErr}
          </div>
        )}
      </div>

      <div className="fixed bottom-0 left-0 right-0 md:left-1/2 z-30
                      bg-gradient-to-t from-white via-white/95 to-white/0 pt-6">
        <div className="mx-auto max-w-xl px-5 md:px-8 pb-4"
             style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1rem)" }}>
          <button
            type="button"
            onClick={onSubmit}
            disabled={!canSubmit}
            className="w-full h-12 md:h-13 lg:h-14 rounded-2xl bg-warm text-warm-foreground font-semibold text-base md:text-[16px] lg:text-[17px]
                       shadow-lg shadow-warm/20 active:scale-[0.98] transition
                       disabled:opacity-50 disabled:active:scale-100"
          >
            {submitting
              ? "Verificando…"
              : "Continuar y ver horarios →"}
          </button>

          <p className="mt-2 text-center text-[11px] text-slate-400 leading-snug">
            Al continuar aceptas nuestra{" "}
            <Link href="/privacy" target="_blank" className="underline text-slate-500">
              política de privacidad
            </Link>
            . Solo usaremos tus datos para contactarte con fines educativos.
          </p>
        </div>
      </div>
      </>
      )}

      {/* === CALENDARIO INLINE — visible una vez registrado.
          Sin resumen propio: CalendarStep ya trae su título "Tu plan
          está listo, X" + nivel + copy, y el resumen externo se
          sentía duplicado. === */}
      {registered && leadId && (
        <CalendarStep
          name={name}
          answers={answers}
          form={form}
          leadId={leadId}
        />
      )}
    </div>
  );
}

/**
 * Step 6 — resumen + calendario inline.
 *
 * Decisión Gelfis 2026-05-02: el usuario debe agendar SIN pasar por
 * otra pantalla intermedia. Sin botón "Ver horarios". Calendario
 * embebido en este mismo paso. Al elegir slot, hacemos POST directo
 * a /api/public/book-trial con todos los datos del quiz + paso 5,
 * y redirigimos a /confirmacion en éxito.
 */
function CalendarStep({
  name, answers, form, leadId,
}: {
  name:    string;
  answers: Answers;
  form:    FormData;
  leadId:  string;
}) {
  const [slots,    setSlots]    = useState<SlotItem[] | null>(null);
  const [loadErr,  setLoadErr]  = useState<string | null>(null);
  const [selectedDay, setDay]   = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<SlotItem | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitErr,  setSubmitErr]  = useState<string | null>(null);
  // Compromisos del lead. Aparecen tras seleccionar slot. El botón
  // "Confirmar" se habilita solo cuando ambos están marcados.
  // Decisión Gelfis 2026-05-22: aumentar la asistencia haciendo que
  // el lead reconozca el valor (€30) y explícitamente se comprometa.
  // 2026-05-26: eliminado el checkbox "valor" — sólo queda el de
  // compromiso de asistencia para reducir fricción en el paso 6.
  const [commitAttend,   setCommitAttend]   = useState(false);
  // Modal de confirmación dual-TZ (Gelfis 2026-06-15). Detectamos la TZ
  // del lead; si difiere de Berlin, exigimos un paso extra antes de
  // disparar book-trial — el lead ve "X tu hora · Y Berlín" y debe
  // confirmar explícitamente. Cierra el bug de leads LATAM que se
  // presentaban a su hora local.
  const [leadTimezone, setLeadTimezone] = useState<string | null>(null);
  const [pendingConfirmation, setPendingConfirmation] = useState(false);
  useEffect(() => { setLeadTimezone(detectBrowserTimezone()); }, []);
  const showDualTz = !!leadTimezone && leadTimezone !== "Europe/Berlin";

  useEffect(() => {
    let cancelled = false;
    fetch("/api/public/trial-slots", { cache: "no-store" })
      .then(r => r.json())
      .then(d => { if (!cancelled) setSlots(d.slots ?? []); })
      .catch(() => { if (!cancelled) setLoadErr("No pudimos cargar los horarios. Recarga la página."); });
    return () => { cancelled = true; };
  }, []);

  // Agrupamos los slots por día en la TZ que el lead percibe. Sin esto,
  // un slot Berlin Sáb 00:30 le aparecería al lead en LATAM bajo "Sábado"
  // del strip cuando para él es viernes por la noche.
  const displayTz = leadTimezone ?? "Europe/Berlin";
  const slotsByDay = useMemo(() => {
    const map = new Map<string, SlotItem[]>();
    for (const s of slots ?? []) {
      const key = new Intl.DateTimeFormat("en-CA", {
        timeZone: displayTz, year: "numeric", month: "2-digit", day: "2-digit",
      }).format(new Date(s.startIso));
      const list = map.get(key) ?? [];
      list.push(s);
      map.set(key, list);
    }
    return map;
  }, [slots, displayTz]);

  const daysWithSlots = useMemo(() => new Set(slotsByDay.keys()), [slotsByDay]);

  useEffect(() => {
    if (!slots || slots.length === 0 || selectedDay) return;
    const firstKey = new Intl.DateTimeFormat("en-CA", {
      timeZone: displayTz, year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date(slots[0].startIso));
    setDay(firstKey);
  }, [slots, selectedDay, displayTz]);

  const fullDateLabel = (key: string): string => {
    const [y, m, d] = key.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d, 12));
    return dt.toLocaleDateString("es-ES", {
      weekday: "long", day: "numeric", month: "long",
    });
  };

  const slotsToday: SlotItem[] = selectedDay ? (slotsByDay.get(selectedDay) ?? []) : [];

  // Click en una hora — solo selecciona. La confirmación de la
  // reserva la dispara el botón "Confirmar [día · hora]" pegado
  // al pie. Decisión Gelfis 2026-05-02: el usuario necesita ver
  // qué eligió antes del submit, no auto-submit al toque.
  const onPickSlot = (s: SlotItem) => {
    if (submitting) return;
    setSelectedSlot(s);
    setSubmitErr(null);
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      try { navigator.vibrate?.(8); } catch { /* iOS no-op */ }
    }
  };

  const canConfirm = !!selectedSlot && commitAttend && !submitting;

  const confirmBooking = async () => {
    if (submitting || !selectedSlot) return;
    if (!commitAttend) {
      setSubmitErr("Marca la casilla de compromiso para confirmar tu reserva.");
      return;
    }
    const s = selectedSlot;
    setSubmitting(true);
    setSubmitErr(null);
    try {
      const levelMap: Record<string, "A0" | "A1" | "A2" | "B1" | "B2" | "C1"> = {
        "A0 — Cero, no sé nada":                          "A0",
        "A1 — Conozco lo básico (saludos, números)":      "A1",
        "A2 — Conversaciones simples del día a día":      "A2",
        "B1 — Hablo de temas cotidianos con fluidez":     "B1",
        "B2 — Me defiendo en contextos exigentes":        "B2",
        "C1 — Nivel avanzado":                            "C1",
      };
      const goalMap: Record<string, string> = {
        "Trabajo":                       "work",
        "Estudios":                      "studies",
        "Vida diaria / integración":     "already_in_dach",
        "Examen oficial / ciudadanía":   "exam",
        "Crecimiento personal":          "travel",
      };

      // WhatsApp es opcional (decisión Gelfis 2026-06-XX): si el lead
      // no lo dio, mandamos null y la confirmación va solo por email.
      const hasWa        = form.whatsapp.replace(/\D/g, "").length > 0;
      const cc           = form.countryCode.startsWith("+") ? form.countryCode : `+${form.countryCode}`;
      const whatsappE164 = hasWa ? combineE164(form.countryCode, form.whatsapp) : null;
      const whatsappRaw  = hasWa ? `${cc} ${form.whatsapp}` : null;

      const res = await fetch("/api/public/book-trial", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name:          form.name.trim(),
          email:         form.email.trim().toLowerCase(),
          whatsapp_e164: whatsappE164,
          whatsapp_raw:  whatsappRaw,
          german_level:  answers.level ? levelMap[answers.level] : "A0",
          goal:          answers.goal  ? goalMap [answers.goal]  : "work",
          language:      "es",
          slot_iso:      s.startIso,
          teacher_id:    s.teacherId,
          gdpr_accepted: true,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 && data.error === "slot_taken") {
        setSubmitErr("Ese horario se acaba de ocupar. Elige otro.");
        fetch("/api/public/trial-slots", { cache: "no-store" })
          .then(r => r.json())
          .then(d => setSlots(d.slots ?? []))
          .catch(() => { /* ignore */ });
        setSubmitting(false);
        return;
      }
      if (!res.ok || !data.ok) {
        setSubmitErr(data.message ?? data.error ?? "No pudimos confirmar tu clase. Inténtalo de nuevo.");
        setSubmitting(false);
        return;
      }
      // /confirmacion EXIGE ?c=<classId>&t=<token> — sin esos params
      // hace `redirect('/')` server-side (ver /app/confirmacion/page.tsx
      // líneas 41 y 44). Sin estos query params, el lead aterrizaba
      // de vuelta en el paso 1 del quiz.
      if (!data.classId || !data.token) {
        setSubmitErr("Tu clase se guardó pero no pudimos cargar la confirmación. Mira tu email — te llegará el enlace ahí.");
        setSubmitting(false);
        return;
      }
      firePixelSchedule({ leadId });
      // Telemetría: paso 7 completado (clase de prueba agendada).
      try {
        const sid = sessionStorage.getItem("b2c.diagnostico.sid");
        if (sid) {
          fetch("/api/public/funnel/track", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ session_id: sid, step: 7, answer: s.startIso }),
            keepalive: true,
          }).catch(() => { /* silencioso */ });
        }
      } catch { /* ignore */ }
      try {
        sessionStorage.removeItem("b2c.agendar.v1");
        sessionStorage.removeItem("diagnostico_lead_id");
        sessionStorage.removeItem("diagnostico_name");
        sessionStorage.removeItem("diagnostico_email");
      } catch { /* ignore */ }
      if (typeof window !== "undefined") {
        const params = new URLSearchParams({ c: data.classId, t: data.token });
        window.location.href = `/confirmacion?${params.toString()}`;
      }
    } catch (e) {
      console.error("[diagnostico] book-trial failed:", e);
      setSubmitErr("Error de conexión. Inténtalo de nuevo.");
      setSubmitting(false);
    }
  };

  // Label del botón "Confirmar [día · hora]" cuando hay slot
  // seleccionado. Formato: "viernes 9 de mayo · 17:00". Si el lead está
  // en otra TZ, formateamos día en SU zona (no en Berlín) — coherente
  // con lo que ve en el strip / TimeList.
  const confirmLabel = (() => {
    if (!selectedSlot) return null;
    const dt = new Date(selectedSlot.startIso);
    const dayPart = dt.toLocaleDateString("es-ES", {
      timeZone: displayTz,
      weekday:  "long",
      day:      "numeric",
      month:    "long",
    });
    const timePart = dt.toLocaleTimeString("es-ES", {
      timeZone: displayTz,
      hour:     "2-digit",
      minute:   "2-digit",
    });
    return `${dayPart} · ${timePart}`;
  })();

  // Texto del modal de confirmación dual-TZ. Muestra "tu hora" y "Berlín"
  // en paralelo. Lo usamos solo si showDualTz=true.
  const dualTzConfirmText = (() => {
    if (!selectedSlot || !showDualTz) return null;
    const dt = new Date(selectedSlot.startIso);
    const localDay = dt.toLocaleDateString("es-ES", {
      timeZone: displayTz, weekday: "long", day: "numeric", month: "long",
    });
    const localTime = dt.toLocaleTimeString("es-ES", {
      timeZone: displayTz, hour: "2-digit", minute: "2-digit",
    });
    const berlinDay = dt.toLocaleDateString("es-ES", {
      timeZone: "Europe/Berlin", weekday: "long", day: "numeric", month: "long",
    });
    const berlinTime = dt.toLocaleTimeString("es-ES", {
      timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit",
    });
    return { localDay, localTime, berlinDay, berlinTime };
  })();

  return (
    <div className={`px-5 pt-6 ${selectedSlot ? "pb-[calc(env(safe-area-inset-bottom)+9rem)] md:pb-[calc(env(safe-area-inset-bottom)+8rem)]" : "pb-12"}`}>
      <h1 className="text-[26px] sm:text-3xl md:text-[30px] lg:text-[36px] font-extrabold tracking-tight text-slate-900">
        ¡Tu plan está listo, {name}!
      </h1>

      {/* Sólo mostramos el Nivel — tras la simplificación del quiz
          (2026-05-26) goal/urgencia ya no se preguntan en el funnel,
          así que mostrar "Objetivo: —" y "Plazo: —" daba la impresión
          de campos rotos. El emoji del nivel se busca en LEVEL_OPTIONS. */}
      <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <SummaryRow
          label="Nivel"
          value={answers.level}
          emoji={
            answers.level
              ? (LEVEL_OPTIONS.find(o => o.id === answers.level)?.emoji ?? null)
              : null
          }
        />
      </div>

      <p className="mt-6 text-[12px] md:text-[13px] font-bold uppercase tracking-wider text-warm-foreground">
        Último paso
      </p>
      <p className="mt-2 text-[15px] md:text-[15px] lg:text-[16px] text-slate-700 leading-relaxed">
        Reserva ahora tu{" "}
        <strong className="bg-warm/15 text-warm-foreground rounded px-1 box-decoration-clone">
          clase de prueba GRATIS de 30 min con un profesor nativo alemán que también habla español
        </strong>
        .
      </p>
      <p className="mt-3 text-[14.5px] md:text-[15px] text-slate-600 leading-relaxed">
        Sin compromisos, elige tu día y hora:
      </p>

      <div className="mt-5">
        {slots === null && !loadErr && (
          <div className="space-y-4">
            <div className="flex gap-2 overflow-hidden">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="shrink-0 w-14 h-[68px] rounded-2xl bg-white/[0.06] animate-pulse" />
              ))}
            </div>
            <div className="space-y-2 mt-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-14 rounded-2xl bg-white/[0.06] animate-pulse" />
              ))}
            </div>
          </div>
        )}
        {loadErr && <p className="text-sm text-red-300">{loadErr}</p>}

        {submitting && (
          <div className="rounded-2xl border border-slate-200 bg-white/[0.04] px-4 py-3
                          text-sm text-slate-700 flex items-center gap-3 mb-4">
            <span className="inline-block h-4 w-4 rounded-full border-2 border-warm border-t-transparent animate-spin" aria-hidden />
            Confirmando tu clase…
          </div>
        )}
        {submitErr && (
          <div className="rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200 mb-4">
            {submitErr}
          </div>
        )}

        {slots && slots.length === 0 && (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-white/[0.03] p-6 text-center text-sm text-slate-500">
            Estamos completos los próximos 30 días. Escríbenos por WhatsApp y te avisamos en cuanto se abran horarios.
          </div>
        )}

        {slots && slots.length > 0 && (
          <div className="space-y-5">
            {showDualTz && (
              <div className="rounded-xl border border-sky-300 bg-sky-50 px-3.5 py-2.5">
                <p className="text-[13px] text-sky-900 leading-snug">
                  🌎 Detectamos que estás en <strong>{leadTimezone}</strong>. Te mostramos los horarios en <strong>tu zona</strong> y al lado la hora del profesor en <strong>Berlín</strong>.
                </p>
              </div>
            )}
            <MobileDayStrip
              daysWithSlots={daysWithSlots}
              selectedDay={selectedDay}
              onSelect={setDay}
              lightMode
              displayTimezone={displayTz}
            />
            {selectedDay && (
              <div>
                <p className="text-[11px] font-semibold uppercase text-slate-500 tracking-wider mb-2 capitalize">
                  {fullDateLabel(selectedDay)}
                </p>
                <TimeList
                  slots={slotsToday}
                  selectedIso={selectedSlot?.startIso ?? null}
                  selectedTeacherId={selectedSlot?.teacherId ?? null}
                  onSelect={onPickSlot}
                  lightMode
                  leadTimezone={leadTimezone}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bloque compromiso IN-PAGE — sólo aparece tras seleccionar slot.
          Va fuera del sticky para que NO se superponga con el botón.
          Se desplaza con el scroll y empuja los slots hacia arriba. */}
      {selectedSlot && confirmLabel && (
        <div className="mx-auto max-w-xl md:max-w-2xl lg:max-w-3xl px-5 mt-6 md:mt-8 space-y-3 md:space-y-4">
          <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3">
            <div className="flex items-start gap-2.5">
              <span className="text-lg leading-none mt-0.5" aria-hidden>💎</span>
              <div className="min-w-0">
                <p className="text-[12px] font-semibold uppercase tracking-wider text-amber-700">
                  Valor de tu clase
                </p>
                <p className="mt-1 text-[14px] md:text-[15px] text-amber-900 leading-snug">
                  Esta clase con un profesor nativo certificado tiene un
                  valor de <strong>30 €</strong>. <strong>Te la regalamos</strong> si
                  asistes a tu primera clase.
                </p>
              </div>
            </div>
          </div>

          <label className="flex items-start gap-3 cursor-pointer px-1 py-2">
            <input
              type="checkbox"
              checked={commitAttend}
              onChange={e => setCommitAttend(e.target.checked)}
              className="mt-0.5 h-5 w-5 accent-warm shrink-0 cursor-pointer"
            />
            <span className="text-[14px] md:text-base text-slate-800 leading-snug">
              Me comprometo a asistir el <strong className="capitalize">{confirmLabel}</strong>.
            </span>
          </label>
        </div>
      )}

      {/* CTA sticky: SOLO el botón Confirmar. El bloque de valor +
          compromiso vive in-page arriba (no se superpone). */}
      {selectedSlot && confirmLabel && (
        <div
          className="fixed bottom-0 left-0 right-0 md:left-1/2 z-30
                     bg-gradient-to-t from-white via-white/95 to-white/0
                     pt-6"
        >
          <div
            className="mx-auto max-w-xl md:max-w-xl lg:max-w-xl px-5 md:px-8 pb-4"
            style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1rem)" }}
          >
            <button
              type="button"
              onClick={() => {
                if (!canConfirm) return;
                if (showDualTz) {
                  setPendingConfirmation(true);
                } else {
                  confirmBooking();
                }
              }}
              disabled={!canConfirm}
              className="w-full h-14 md:h-13 lg:h-14 rounded-2xl bg-warm text-warm-foreground font-semibold
                         shadow-lg shadow-warm/20 active:scale-[0.98] transition
                         disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100
                         flex flex-col items-center justify-center gap-0.5"
            >
              {submitting ? (
                <span className="flex items-center gap-2 text-base">
                  <span className="inline-block h-4 w-4 rounded-full border-2 border-current border-t-transparent animate-spin" aria-hidden />
                  Confirmando…
                </span>
              ) : (
                <>
                  <span className="text-[11px] md:text-xs font-semibold uppercase tracking-[0.14em] opacity-75">
                    Confirmar
                  </span>
                  <span className="text-[15px] md:text-[16px] lg:text-[17px] font-bold capitalize">
                    {confirmLabel}
                  </span>
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Modal de confirmación dual-TZ (Gelfis 2026-06-15). Se abre
          solo cuando la TZ del lead difiere de Berlín. Muestra ambas
          horas explícitamente para que el lead confirme que entendió
          la diferencia antes de reservar. */}
      {pendingConfirmation && selectedSlot && dualTzConfirmText && (
        <div
          className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4"
          onClick={() => { if (!submitting) setPendingConfirmation(false); }}
        >
          <div
            className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <h2 className="text-xl font-extrabold text-slate-900">
              ✅ Confirma el horario
            </h2>
            <p className="mt-1 text-sm text-slate-600 leading-snug">
              Tu clase es en hora de Berlín (donde está el profe). Revisa que coincida con tu agenda local.
            </p>

            <div className="mt-5 space-y-3">
              <div className="rounded-2xl border-2 border-warm bg-warm/10 px-4 py-3">
                <p className="text-[11px] font-bold uppercase tracking-wider text-warm-foreground">
                  🕐 En tu zona ({leadTimezone})
                </p>
                <p className="mt-1 text-[15px] font-bold text-slate-900 capitalize">
                  {dualTzConfirmText.localDay}
                </p>
                <p className="text-2xl font-extrabold text-slate-900 tabular-nums leading-tight">
                  {dualTzConfirmText.localTime}
                </p>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  🇩🇪 En Berlín (zona del profesor)
                </p>
                <p className="mt-1 text-[14px] font-semibold text-slate-700 capitalize">
                  {dualTzConfirmText.berlinDay}
                </p>
                <p className="text-xl font-bold text-slate-700 tabular-nums leading-tight">
                  {dualTzConfirmText.berlinTime}
                </p>
              </div>
            </div>

            {submitErr && (
              <div className="mt-4 rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-[13px] text-red-800">
                {submitErr}
              </div>
            )}

            <div className="mt-6 flex flex-col gap-2">
              <button
                type="button"
                onClick={confirmBooking}
                disabled={submitting}
                className="h-12 rounded-2xl bg-warm text-warm-foreground font-bold
                           shadow-lg shadow-warm/20 active:scale-[0.98] transition
                           disabled:opacity-50 disabled:cursor-not-allowed
                           flex items-center justify-center gap-2"
              >
                {submitting ? (
                  <>
                    <span className="inline-block h-4 w-4 rounded-full border-2 border-current border-t-transparent animate-spin" aria-hidden />
                    Confirmando…
                  </>
                ) : (
                  "Sí, confirmar reserva"
                )}
              </button>
              <button
                type="button"
                onClick={() => setPendingConfirmation(false)}
                disabled={submitting}
                className="h-11 rounded-2xl border border-slate-200 text-slate-700 font-semibold text-sm
                           hover:bg-slate-50 disabled:opacity-50"
              >
                Cambiar horario
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Pantalla "gracias email-only" — se muestra cuando el lead completó
 * nombre+email pero no dio WhatsApp. El lead ya está registrado, el
 * drip por email se hará cargo.
 *
 * Cambio 2026-06-XX (Gelfis): TODO lead debe poder agendar — el CTA
 * principal ahora abre el calendario inline (sin WA). El wa.me link
 * queda como alternativa secundaria por si prefieren chatear.
 */
function EmailOnlyThanksScreen({
  name, email, onScheduleClick,
}: {
  name: string;
  email: string;
  onScheduleClick: () => void;
}) {
  // Pre-rellenamos un mensaje con su nombre + email para que Stiv
  // pueda enlazar la conversación con el lead automáticamente.
  const waText = `Hola Stiv, soy ${name} (${email}). Acabo de registrarme en el funnel y quiero coordinar mi clase de prueba por WhatsApp.`;
  const waUrl  = `https://wa.me/491607530948?text=${encodeURIComponent(waText)}`;
  return (
    <div className="px-5 md:px-8 pt-8 md:pt-12 lg:pt-16 pb-12 md:pb-16">
      <h1 className="text-[26px] sm:text-3xl md:text-[30px] lg:text-[36px] font-extrabold tracking-tight text-slate-900">
        ¡Listo, {name}!
      </h1>
      <p className="mt-3 text-[15px] md:text-[15px] lg:text-[16px] text-slate-600 leading-relaxed">
        Recibimos tu solicitud. Te hemos enviado un correo a <strong>{email}</strong> con
        los pasos siguientes y materiales para empezar.
      </p>
      <p className="mt-2 text-[14px] md:text-base text-slate-600 leading-relaxed">
        Revisa tu bandeja de entrada (y la de spam, por si acaso) en los próximos minutos.
      </p>

      {/* CTA principal — agendar AHORA sin WhatsApp */}
      <div className="mt-7 rounded-2xl border-2 border-warm bg-warm/10 p-5">
        <p className="text-[12px] font-bold uppercase tracking-wider text-warm-foreground">
          🎯 Da el siguiente paso ahora
        </p>
        <h2 className="mt-1.5 text-[18px] md:text-[20px] font-extrabold text-slate-900 leading-tight">
          Agenda tu clase de prueba gratuita
        </h2>
        <p className="mt-1.5 text-[14px] text-slate-700 leading-snug">
          Escoge el horario que mejor te venga. La confirmación con el enlace
          de Zoom te llega al email.
        </p>
        <button
          type="button"
          onClick={onScheduleClick}
          className="mt-4 inline-flex items-center justify-center gap-2 w-full md:w-auto
                     h-12 px-6 rounded-2xl bg-warm text-warm-foreground font-semibold text-[15px]
                     shadow-lg shadow-warm/20 active:scale-[0.98] transition"
        >
          📅 Agendar mi clase ahora →
        </button>
      </div>

      {/* Alternativa secundaria — coordinar por WhatsApp */}
      <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <p className="text-[13px] font-semibold text-slate-700">
          ¿Prefieres coordinarlo por WhatsApp?
        </p>
        <p className="mt-1 text-[13px] text-slate-600 leading-snug">
          Stiv te ayuda a escoger el mejor horario y te envía los recordatorios.
        </p>
        <a
          href={waUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex items-center gap-2 h-10 px-4 rounded-xl
                     bg-emerald-500 text-white font-semibold text-[13.5px]
                     active:scale-[0.98] transition"
        >
          💬 Hablar con Stiv por WhatsApp
        </a>
      </div>

      <p className="mt-6 text-[12.5px] text-slate-500 leading-relaxed">
        También puedes responder al email que te acabamos de enviar y
        Stiv te coordinará todo desde ahí.
      </p>
    </div>
  );
}

function AlreadyRegisteredScreen({ loginUrl, onBack }: { loginUrl: string; onBack: () => void }) {
  return (
    <div className="px-5 md:px-8 pt-8 md:pt-12 lg:pt-16 pb-12 md:pb-16">
      <h1 className="text-[26px] sm:text-3xl md:text-[30px] lg:text-[36px] font-extrabold tracking-tight text-slate-900">
        Ese email ya tiene cuenta
      </h1>
      <p className="mt-4 text-[15px] md:text-[15px] lg:text-[16px] text-slate-700 leading-relaxed">
        Detectamos que ya eres parte de Aprender-Aleman.de con ese email.
        Inicia sesión y agenda tu clase desde tu panel.
      </p>

      <a
        href={loginUrl}
        className="mt-7 block w-full text-center h-12 rounded-2xl bg-warm text-warm-foreground
                   font-semibold text-base shadow-lg shadow-warm/20 active:scale-[0.98] transition
                   leading-[3rem]"
      >
        Iniciar sesión
      </a>

      <button
        type="button"
        onClick={onBack}
        className="mt-3 block w-full text-center h-12 rounded-2xl
                   border border-slate-300 text-slate-700 font-medium
                   active:scale-[0.98] transition"
      >
        ← Usar otro email
      </button>
    </div>
  );
}

function SummaryRow({
  label, value, emoji,
}: {
  label: string;
  value: string | null;
  emoji?: string | null;
}) {
  return (
    <div className="flex items-baseline gap-3">
      <div className="text-[12px] uppercase tracking-[0.14em] text-slate-400 w-20 shrink-0">
        {label}
      </div>
      <div className="text-[15px] text-slate-900 font-medium flex items-center gap-2">
        {emoji && <span className="text-xl leading-none" aria-hidden>{emoji}</span>}
        <span>{value ?? "—"}</span>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-[12px] uppercase tracking-[0.14em] text-slate-500 mb-1.5">
        {label}
      </div>
      {children}
    </label>
  );
}
