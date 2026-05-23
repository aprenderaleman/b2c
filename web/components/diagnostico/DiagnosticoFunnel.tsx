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
import { RobotMark }                    from "@/components/RobotMark";

// ── Opciones del quiz (sincronizadas 1-a-1 con el endpoint
//    /api/public/diagnostico/register — si cambias texto aquí cámbialo
//    también allá o el server rechazará el body) ──────────────────

const LEVEL_OPTIONS = [
  { id: "Cero / no sé nada",     emoji: "🌱" },
  { id: "Básico (A1-A2)",        emoji: "📘" },
  { id: "Intermedio (B1-B2)",    emoji: "💬" },
  { id: "Avanzado (C1+)",        emoji: "🎯" },
  { id: "No estoy seguro",       emoji: "🤔" },
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
const MOTIVO_OPTIONS = [
  { id: "particulares", emoji: "👨‍🏫", h3: "Clases particulares de alemán online" },
  { id: "intensivo",    emoji: "🚀", h3: "Curso intensivo de alemán online" },
  { id: "certificado",  emoji: "🏅", h3: "Cursos de alemán con certificado oficial (TELC, FIDE, Goethe)" },
  { id: "profesional",  emoji: "💼", h3: "Alemán para trabajar (profesionales)" },
  { id: "otro",         emoji: "💭", h3: "Tengo otro motivo" },
] as const;

type MotivoId = typeof MOTIVO_OPTIONS[number]["id"];

const MOTIVO_PERSONALIZED_H2: Record<MotivoId, string> = {
  particulares: "Perfecto, vamos a encontrar tu profesor para clases particulares",
  intensivo:    "Perfecto, te preparamos un curso intensivo a tu medida",
  certificado:  "Perfecto, te ayudamos a obtener tu certificado oficial",
  profesional:  "Perfecto, te preparamos el alemán que necesitas para tu profesión",
  otro:         "Cuéntanos un poco más y adaptamos el plan",
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

// Pasos del funnel. Tras introducir motivo_inicial el orden es:
//   1: motivo (nuevo, Q.Score)
//   2: nivel (era el viejo paso 1, ahora con H2 personalizado encima)
//   3: objetivo
//   4: urgencia
//   5: presupuesto
//   "low_budget_exit": pantalla SCHULE (no cuenta visualmente)
//   6: captura de datos
//   7: resumen + calendario
type Step = 1 | 2 | 3 | 4 | 5 | "low_budget_exit" | 6 | 7;

/**
 * Combina country code + número local en E.164 protegiéndose de los
 * casos típicos en que el usuario tipea el número con el código país
 * incluido (caso real Juan José 2026-05-07: select="+34" + input="34
 * 615 541 087" → resultado "+3434615541087" que rompía Evolution).
 *
 * Reglas de saneo:
 *  1. Strip non-digits.
 *  2. Si el número empieza por "00", interpreta como prefijo internacional
 *     y descarta los dos ceros (ej. "0034611..." → "34611...").
 *  3. Si los dígitos restantes empiezan por el country-code numérico Y
 *     son lo suficientemente largos para considerarse duplicados, lo
 *     elimina.
 *  4. Quita 0 inicial nacional ("0611..." en muchos países = trunk).
 *  5. Concatena `+` + ccDigits + localDigits.
 */
export function combineE164(countryCode: string, localInput: string): string {
  const ccDigits = countryCode.replace(/\D/g, "");
  let digits = (localInput ?? "").replace(/\D/g, "");
  // (2) prefijo "00" → quitarlo y volver a iterar
  if (digits.startsWith("00")) digits = digits.slice(2);
  // (3) si ya viene con CC y queda un número plausible (≥6 dígitos) tras
  //     quitarlo, lo descartamos para no duplicar.
  if (ccDigits && digits.startsWith(ccDigits) && digits.length - ccDigits.length >= 6) {
    digits = digits.slice(ccDigits.length);
  }
  // (4) trunk nacional 0
  if (digits.startsWith("0")) digits = digits.slice(1);
  return `+${ccDigits}${digits}`;
}

export function DiagnosticoFunnel() {
  const [step, setStep]       = useState<Step>(1);
  const [answers, setAnswers] = useState<Answers>({
    motivo: null, level: null, goal: null, urgency: null, budget: null,
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

  // Theme color para la barra de estado en móvil
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.setAttribute("name", "theme-color");
    meta.setAttribute("content", "#0F2847");
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

  // Progreso visual — 6 pasos visibles (la pantalla SCHULE no cuenta)
  const visualStepNum =
    step === "low_budget_exit" ? 5 :
    step === 6 ? 6 :
    step === 7 ? 6 :
    step;
  const totalSteps = 6;
  const progressPct = (visualStepNum / totalSteps) * 100;

  // Handlers ────────────────────────────────────────────────────

  async function pickMotivo(id: MotivoId) {
    setAnswers(a => ({ ...a, motivo: id }));
    setStep(2);
    // Persist a la BD via session_id. Fire-and-forget para no
    // bloquear la transición visual.
    if (sessionId) {
      try {
        await fetch("/api/public/motivo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_id: sessionId, motivo: id }),
        });
      } catch { /* silencioso */ }
    }
  }
  function pickLevel(id: typeof LEVEL_OPTIONS[number]["id"]) {
    setAnswers(a => ({ ...a, level: id }));
    setStep(3);
  }
  function pickGoal(id: typeof GOAL_OPTIONS[number]["id"]) {
    setAnswers(a => ({ ...a, goal: id }));
    setStep(4);
  }
  function pickUrgency(id: typeof URGENCY_OPTIONS[number]["id"]) {
    setAnswers(a => ({ ...a, urgency: id }));
    setStep(5);
  }
  function pickBudget(id: typeof BUDGET_OPTIONS[number]["id"], lowBudget: boolean) {
    setAnswers(a => ({ ...a, budget: id }));
    setStep(lowBudget ? "low_budget_exit" : 6);
  }

  function goBack() {
    if (step === 7) return; // no hay back desde resumen
    if (step === 6) setStep(5);
    else if (step === "low_budget_exit") setStep(5);
    else if (step === 5) setStep(4);
    else if (step === 4) setStep(3);
    else if (step === 3) setStep(2);
    else if (step === 2) setStep(1);
    // step 1 → no hace nada (es el inicio)
  }

  async function submitData() {
    if (submitting) return;
    setSubmitting(true);
    setSubmitErr(null);
    try {
      // Normalizar whatsapp a E.164. El usuario puede teclear el número
      // de varias formas — limpiamos para evitar el bug "+34" + "+34..."
      // = "+3434...":
      //   1. Quitar todo lo que no sean dígitos
      //   2. Si los dígitos ya empiezan por el country code numérico,
      //      quitarlo (caso: usuario seleccionó +34 y tecleó "34611...")
      //   3. Quitar 0 inicial (prefijo nacional típico)
      const whatsappE164 = combineE164(form.countryCode, form.whatsapp);

      const body = {
        name:           form.name.trim(),
        email:          form.email.trim().toLowerCase(),
        whatsapp_e164:  whatsappE164,
        country:        form.country,
        language:       "es",
        gdpr_accepted:  true,
        // Paso 1 nuevo (motivo_inicial) + session_id para que el
        // backend enlace lead_motivo_inicial.lead_id.
        session_id:     sessionId ?? undefined,
        motivo_inicial: answers.motivo ?? undefined,
        answers: {
          level:   answers.level,
          goal:    answers.goal,
          urgency: answers.urgency,
          budget:  answers.budget,
        },
      };

      const res = await fetch("/api/public/diagnostico/register", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
      });
      const json = await res.json();
      if (res.status === 409 && json.error === "already_registered") {
        setAlreadyRegistered({ loginUrl: json.login_url ?? "/login" });
        setSubmitting(false);
        return;
      }
      if (!res.ok || !json.ok) {
        setSubmitErr(json.error ?? "No se pudo guardar. Inténtalo de nuevo.");
        setSubmitting(false);
        return;
      }

      // Lead guardado. Disparar pixels y avanzar al resumen.
      firePixelLead({
        leadId: json.lead_id,
        email:  body.email,
        budget: body.answers.budget,
      });

      // Pre-cargar el booking-state que usa `/agendar/*` para que el
      // siguiente paso (slot picker) tenga toda la info y NO le pida
      // al lead que reescriba nombre, email, teléfono, nivel y
      // objetivo. La flag `from_diagnostico=true` le dice a la
      // página `/agendar/cuando` que tras escoger horario haga submit
      // directo a /api/public/book-trial sin pasar por /tu /nivel
      // /objetivo.
      const levelMap: Record<string, "A0" | "A1-A2" | "B1" | "B2+"> = {
        "Cero / no sé nada":     "A0",
        "Básico (A1-A2)":        "A1-A2",
        "Intermedio (B1-B2)":    "B1",
        "Avanzado (C1+)":        "B2+",
        "No estoy seguro":       "A0",
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
        lead_id:          json.lead_id,
        savedAt:          Date.now(),
      };
      try {
        sessionStorage.setItem("b2c.agendar.v1", JSON.stringify(bookingState));
        // Backwards-compat keys (por si algo los leía).
        sessionStorage.setItem("diagnostico_lead_id", json.lead_id);
        sessionStorage.setItem("diagnostico_name",    form.name.trim());
        sessionStorage.setItem("diagnostico_email",   body.email);
      } catch { /* ignore */ }

      setLeadId(json.lead_id);
      setStep(7);
    } catch (e) {
      console.error("[diagnostico] submit failed:", e);
      setSubmitErr("Error de conexión. Inténtalo de nuevo.");
      setSubmitting(false);
    }
  }

  // ── Render ──────────────────────────────────────────────────

  return (
    <div className="theme-dark min-h-[100dvh] bg-navy-900 text-white flex flex-col"
         style={{ overscrollBehavior: "contain" }}>
      {/* Header sticky */}
      <header
        className="sticky top-0 z-40 backdrop-blur bg-navy-900/95 border-b border-white/5"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <div className="mx-auto max-w-xl md:max-w-2xl lg:max-w-3xl flex items-center justify-between gap-2 h-14 md:h-16 px-3">
          <button
            type="button"
            onClick={goBack}
            disabled={step === 1 || step === 7}
            className="h-10 w-10 inline-flex items-center justify-center rounded-full
                       text-white/85 hover:bg-white/10 active:scale-95 transition
                       disabled:opacity-30 disabled:active:scale-100"
            aria-label="Paso anterior"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>

          {/* Brand: logo + wordmark. Click vuelve a la home (reinicia
              el quiz). Tamaño compacto para no robar foco al contenido. */}
          <Link
            href="/"
            aria-label="Aprender-Aleman.de"
            className="flex items-center gap-1.5 md:gap-2 text-white/90 active:scale-[0.97] transition"
          >
            <span className="md:hidden"><RobotMark size={26} /></span>
            <span className="hidden md:inline-block"><RobotMark size={32} /></span>
            <span className="text-[13px] sm:text-sm md:text-base lg:text-lg font-semibold tracking-tight">
              Aprender-Aleman<span className="text-warm">.de</span>
            </span>
          </Link>

          {/* Indicador discreto de paso en el slot derecho. Para los
              pasos sin número (low_budget_exit, 7) lo escondemos. */}
          <div className="h-10 w-10 inline-flex items-center justify-end pr-1">
            {step !== "low_budget_exit" && step !== 7 && (
              <span className="text-[11px] font-semibold tracking-wide text-white/55 tabular-nums">
                {visualStepNum}/{totalSteps}
              </span>
            )}
          </div>
        </div>
        <div className="h-0.5 bg-white/5">
          <div
            className="h-full bg-warm transition-[width] duration-300 ease-out"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </header>

      <main className="flex-1 mx-auto w-full max-w-xl md:max-w-2xl lg:max-w-3xl">
        {step === 1 && (
          <MotivoInicialStep
            selected={answers.motivo}
            onPick={pickMotivo}
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
              countries={COUNTRY_OPTIONS}
              submitting={submitting}
              submitErr={submitErr}
              onSubmit={submitData}
            />
          )
        )}
        {step === 7 && leadId && (
          <CalendarStep
            name={form.name.trim().split(/\s+/)[0] || "tú"}
            answers={answers}
            form={form}
            leadId={leadId}
          />
        )}
      </main>
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
    <div className="px-5 md:px-8 pt-5 md:pt-10 lg:pt-14 pb-10 md:pb-16">
      {/* Título centrado, +10% en móvil (text-[27px] vs antes 24).
          Tracking más cerrado para que el centrado se vea balanced. */}
      <h1 className="text-center text-[27px] sm:text-3xl md:text-4xl lg:text-[44px] font-extrabold tracking-tight text-white leading-tight">
        Aprende alemán con profesores nativos
      </h1>
      {/* +10% en móvil (text-[20px] vs antes 18). Centrado para
          coherencia con el h1. Aumento margen superior — antes era
          mt-3, ahora mt-7/mt-8 (móvil) y mt-12 (desktop) para dejar
          respirar el título. */}
      <h2
        id="motivo-inicial-question"
        className="mt-7 md:mt-12 lg:mt-16 text-center text-[20px] sm:text-xl md:text-2xl lg:text-[26px] font-semibold text-white/90 leading-snug"
      >
        ¿Qué tipo de clases de alemán buscas?
      </h2>
      {/* Margen extra entre la pregunta y las opciones (mt-7 mobile,
          mt-10 desktop) — antes mt-4. */}
      <ul
        role="radiogroup"
        aria-labelledby="motivo-inicial-question"
        className="mt-7 md:mt-10 space-y-2"
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
                            text-left text-white
                            border transition active:scale-[0.99]
                            ${isSelected
                              ? "border-warm bg-warm/15"
                              : "border-white/10 bg-white/5 hover:bg-white/10"}`}
              >
                <span className="text-[22px] sm:text-xl md:text-2xl leading-none shrink-0" aria-hidden>
                  {opt.emoji}
                </span>
                {/* +10% en móvil (text-[15.5px] vs antes 14) */}
                <h3 className="text-[15.5px] sm:text-[15px] md:text-base lg:text-lg leading-snug font-medium m-0">
                  {opt.h3}
                </h3>
              </button>
            </li>
          );
        })}
      </ul>
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
    <div className="px-5 md:px-8 pt-6 md:pt-10 lg:pt-14 pb-12 md:pb-16">
      {personalizedH2 && (
        <h2 className="mb-4 md:mb-5 text-[18px] sm:text-xl md:text-2xl lg:text-[26px] font-semibold text-warm leading-snug">
          {personalizedH2}
        </h2>
      )}
      <h1 className="text-[26px] sm:text-3xl md:text-4xl lg:text-[44px] font-extrabold tracking-tight text-white">
        {title}
      </h1>
      <ul className="mt-6 space-y-3">
        {options.map(opt => {
          const isSelected = selected === opt.id;
          return (
            <li key={opt.id}>
              <button
                type="button"
                onClick={() => onPick(opt.id)}
                className={`w-full flex items-center gap-3 md:gap-4 px-4 md:px-5 h-16 md:h-[72px] lg:h-20 rounded-2xl
                            text-left text-white font-medium
                            border transition active:scale-[0.99]
                            ${isSelected
                              ? "border-warm bg-warm/15"
                              : "border-white/10 bg-white/5 hover:bg-white/10"}`}
              >
                <span className="text-2xl md:text-3xl" aria-hidden>{opt.emoji}</span>
                <span className="text-[15px] md:text-base lg:text-lg leading-snug">{opt.label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function LowBudgetExit({ onBack }: { onBack: () => void }) {
  return (
    <div className="px-5 md:px-8 pt-8 md:pt-12 lg:pt-16 pb-12 md:pb-16">
      <h1 className="text-[26px] sm:text-3xl md:text-4xl lg:text-[44px] font-extrabold tracking-tight text-white">
        Gracias por contarnos tu situación
      </h1>
      <p className="mt-4 text-[15px] md:text-base lg:text-lg text-white/80 leading-relaxed">
        Nuestras clases con profesores empiezan desde 285€/mes, así que probablemente
        no encajemos con tu momento actual. Pero no te quedes sin avanzar — empieza
        con Schule, nuestra plataforma de auto-estudio impulsada por IA.
      </p>

      <div className="mt-7 rounded-2xl border border-white/10 bg-white/5 p-5">
        <div className="text-[13px] font-semibold uppercase tracking-[0.16em] text-warm">
          ✨ Empieza con Schule
        </div>
        <p className="mt-2 text-[14px] text-white/75 leading-relaxed">
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
                   border border-white/15 text-white/85 font-medium
                   active:scale-[0.98] transition"
      >
        ← Cambiar mi presupuesto
      </button>
    </div>
  );
}

function DataCaptureStep({
  form, setForm, countries, submitting, submitErr, onSubmit,
}: {
  form:        FormData;
  setForm:     React.Dispatch<React.SetStateAction<FormData>>;
  countries:   { code: string; name: string }[];
  submitting:  boolean;
  submitErr:   string | null;
  onSubmit:    () => void;
}) {
  const emailValid = useMemo(() => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()), [form.email]);
  const phoneDigits = form.whatsapp.replace(/\D/g, "");
  const canSubmit =
    form.name.trim().length >= 2 &&
    emailValid &&
    phoneDigits.length >= 6 &&
    form.country.length === 2 &&
    form.gdpr &&
    !submitting;

  return (
    <div className="px-5 pt-6 pb-[calc(env(safe-area-inset-bottom)+5.5rem)]">
      <h1 className="text-[26px] sm:text-3xl md:text-4xl lg:text-[44px] font-extrabold tracking-tight text-white">
        ¡Estamos creando tu plan!
      </h1>
      <p className="mt-2 text-[15px] md:text-base lg:text-lg text-white/70 leading-relaxed">
        Para enviártelo y agendar tu clase de prueba, necesitamos tus datos:
      </p>

      <div className="mt-6 space-y-4">
        <Field label="Nombre completo">
          <input
            type="text"
            autoComplete="name"
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            className="w-full h-12 md:h-14 px-4 md:text-base lg:text-lg rounded-xl bg-white/5 border border-white/10
                       text-white placeholder:text-white/40
                       focus:outline-none focus:border-warm focus:bg-white/10"
            placeholder="Tu nombre y apellido"
          />
        </Field>

        <Field label="Email">
          <input
            type="email"
            autoComplete="email"
            value={form.email}
            onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
            className="w-full h-12 md:h-14 px-4 md:text-base lg:text-lg rounded-xl bg-white/5 border border-white/10
                       text-white placeholder:text-white/40
                       focus:outline-none focus:border-warm focus:bg-white/10"
            placeholder="tu@email.com"
          />
        </Field>

        <Field label="WhatsApp">
          <div className="flex gap-2">
            <input
              type="tel"
              inputMode="tel"
              value={form.countryCode}
              onChange={e => setForm(f => ({ ...f, countryCode: e.target.value.replace(/[^0-9+]/g, "") }))}
              className="w-20 md:w-24 h-12 md:h-14 px-3 md:text-base lg:text-lg rounded-xl bg-white/5 border border-white/10
                         text-white text-center
                         focus:outline-none focus:border-warm focus:bg-white/10"
              placeholder="+49"
            />
            <input
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={form.whatsapp}
              onChange={e => setForm(f => ({ ...f, whatsapp: e.target.value }))}
              className="flex-1 h-12 md:h-14 px-4 md:text-base lg:text-lg rounded-xl bg-white/5 border border-white/10
                         text-white placeholder:text-white/40
                         focus:outline-none focus:border-warm focus:bg-white/10"
              placeholder="152 123 4567"
            />
          </div>
          <p className="mt-2 text-[12px] sm:text-xs text-white/55 leading-snug">
            Verifica que tu número sea correcto — ahí enviaremos el
            enlace para tu clase.
          </p>
        </Field>

        <Field label="País de residencia">
          <select
            value={form.country}
            onChange={e => setForm(f => ({ ...f, country: e.target.value }))}
            className="w-full h-12 md:h-14 px-3 md:text-base lg:text-lg rounded-xl bg-white/5 border border-white/10
                       text-white
                       focus:outline-none focus:border-warm focus:bg-white/10"
          >
            {countries.map(c => (
              <option key={c.code} value={c.code} className="bg-navy-900 text-white">
                {c.name}
              </option>
            ))}
          </select>
        </Field>

        <p className="text-xs text-white/55 leading-relaxed pt-2">
          Solo usaremos tus datos para contactarte con fines educativos relacionados con
          tu plan de aprendizaje. Nunca los compartiremos con terceros.
        </p>

        <label className="flex items-start gap-3 cursor-pointer pt-1">
          <input
            type="checkbox"
            checked={form.gdpr}
            onChange={e => setForm(f => ({ ...f, gdpr: e.target.checked }))}
            className="mt-1 h-5 w-5 rounded accent-warm"
          />
          <span className="text-[13px] text-white/85 leading-relaxed">
            Acepto la{" "}
            <Link href="/privacy" target="_blank" className="underline text-warm">
              política de privacidad
            </Link>
          </span>
        </label>

        {submitErr && (
          <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {submitErr}
          </div>
        )}
      </div>

      <div className="fixed bottom-0 left-0 right-0 z-30
                      bg-gradient-to-t from-navy-900 via-navy-900/95 to-navy-900/0 pt-6">
        <div className="mx-auto max-w-xl md:max-w-2xl lg:max-w-3xl px-5 pb-4"
             style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1rem)" }}>
          <button
            type="button"
            onClick={onSubmit}
            disabled={!canSubmit}
            className="w-full h-12 md:h-14 lg:h-16 rounded-2xl bg-warm text-warm-foreground font-semibold text-base md:text-lg lg:text-xl
                       shadow-lg shadow-warm/20 active:scale-[0.98] transition
                       disabled:opacity-50 disabled:active:scale-100"
          >
            {submitting ? "Creando tu plan…" : "Crear mi plan"}
          </button>
        </div>
      </div>
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

  useEffect(() => {
    let cancelled = false;
    fetch("/api/public/trial-slots", { cache: "no-store" })
      .then(r => r.json())
      .then(d => { if (!cancelled) setSlots(d.slots ?? []); })
      .catch(() => { if (!cancelled) setLoadErr("No pudimos cargar los horarios. Recarga la página."); });
    return () => { cancelled = true; };
  }, []);

  const slotsByDay = useMemo(() => {
    const map = new Map<string, SlotItem[]>();
    for (const s of slots ?? []) {
      const key = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit",
      }).format(new Date(s.startIso));
      const list = map.get(key) ?? [];
      list.push(s);
      map.set(key, list);
    }
    return map;
  }, [slots]);

  const daysWithSlots = useMemo(() => new Set(slotsByDay.keys()), [slotsByDay]);

  useEffect(() => {
    if (!slots || slots.length === 0 || selectedDay) return;
    const firstKey = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date(slots[0].startIso));
    setDay(firstKey);
  }, [slots, selectedDay]);

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

  const confirmBooking = async () => {
    if (submitting || !selectedSlot) return;
    const s = selectedSlot;
    setSubmitting(true);
    setSubmitErr(null);
    try {
      const levelMap: Record<string, "A0" | "A1-A2" | "B1" | "B2+"> = {
        "Cero / no sé nada":     "A0",
        "Básico (A1-A2)":        "A1-A2",
        "Intermedio (B1-B2)":    "B1",
        "Avanzado (C1+)":        "B2+",
        "No estoy seguro":       "A0",
      };
      const goalMap: Record<string, string> = {
        "Trabajo":                       "work",
        "Estudios":                      "studies",
        "Vida diaria / integración":     "already_in_dach",
        "Examen oficial / ciudadanía":   "exam",
        "Crecimiento personal":          "travel",
      };

      const cc           = form.countryCode.startsWith("+") ? form.countryCode : `+${form.countryCode}`;
      const whatsappE164 = combineE164(form.countryCode, form.whatsapp);

      const res = await fetch("/api/public/book-trial", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name:          form.name.trim(),
          email:         form.email.trim().toLowerCase(),
          whatsapp_e164: whatsappE164,
          whatsapp_raw:  `${cc} ${form.whatsapp}`,
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
  // seleccionado. Formato: "viernes 9 de mayo · 17:00".
  const confirmLabel = (() => {
    if (!selectedSlot) return null;
    const dt = new Date(selectedSlot.startIso);
    const dayPart = dt.toLocaleDateString("es-ES", {
      timeZone: "Europe/Berlin",
      weekday:  "long",
      day:      "numeric",
      month:    "long",
    });
    const timePart = dt.toLocaleTimeString("es-ES", {
      timeZone: "Europe/Berlin",
      hour:     "2-digit",
      minute:   "2-digit",
    });
    return `${dayPart} · ${timePart}`;
  })();

  return (
    <div className={`px-5 pt-6 ${selectedSlot ? "pb-[calc(env(safe-area-inset-bottom)+5.5rem)]" : "pb-12"}`}>
      <h1 className="text-[26px] sm:text-3xl md:text-4xl lg:text-[44px] font-extrabold tracking-tight text-white">
        ¡Tu plan está listo, {name}!
      </h1>

      <div className="mt-5 rounded-2xl border border-white/10 bg-white/5 p-4 space-y-2.5">
        <SummaryRow label="Nivel"    value={answers.level} />
        <SummaryRow label="Objetivo" value={answers.goal} />
        <SummaryRow label="Plazo"    value={answers.urgency} />
      </div>

      <p className="mt-6 text-[15px] md:text-base lg:text-lg text-white/85 leading-relaxed">
        Reserva ahora tu clase de <strong>alemán</strong> prueba <strong>GRATIS de 30 min</strong> con tu profesor alemán nativo que también habla español:
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
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3
                          text-sm text-white/85 flex items-center gap-3 mb-4">
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
          <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] p-6 text-center text-sm text-white/65">
            Estamos completos los próximos 30 días. Escríbenos por WhatsApp y te avisamos en cuanto se abran horarios.
          </div>
        )}

        {slots && slots.length > 0 && (
          <div className="space-y-5">
            <MobileDayStrip
              daysWithSlots={daysWithSlots}
              selectedDay={selectedDay}
              onSelect={setDay}
            />
            {selectedDay && (
              <div>
                <p className="text-[11px] font-semibold uppercase text-white/55 tracking-wider mb-2 capitalize">
                  {fullDateLabel(selectedDay)}
                </p>
                <TimeList
                  slots={slotsToday}
                  selectedIso={selectedSlot?.startIso ?? null}
                  selectedTeacherId={selectedSlot?.teacherId ?? null}
                  onSelect={onPickSlot}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* CTA sticky de confirmación. Solo se muestra cuando el lead ha
          escogido un slot — antes no hay nada que confirmar. */}
      {selectedSlot && confirmLabel && (
        <div
          className="fixed bottom-0 left-0 right-0 z-30
                     bg-gradient-to-t from-navy-900 via-navy-900/95 to-navy-900/0
                     pt-6"
        >
          <div
            className="mx-auto max-w-xl md:max-w-2xl lg:max-w-3xl px-5 pb-4"
            style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1rem)" }}
          >
            <button
              type="button"
              onClick={confirmBooking}
              disabled={submitting}
              className="w-full h-14 md:h-16 lg:h-[68px] rounded-2xl bg-warm text-warm-foreground font-semibold
                         shadow-lg shadow-warm/20 active:scale-[0.98] transition
                         disabled:opacity-60 disabled:active:scale-100
                         flex flex-col items-center justify-center gap-0.5"
            >
              {submitting ? (
                <span className="flex items-center gap-2 text-base md:text-lg">
                  <span className="inline-block h-4 w-4 rounded-full border-2 border-current border-t-transparent animate-spin" aria-hidden />
                  Confirmando…
                </span>
              ) : (
                <>
                  <span className="text-[11px] md:text-xs font-semibold uppercase tracking-[0.14em] opacity-75">
                    Confirmar
                  </span>
                  <span className="text-[15px] md:text-lg lg:text-xl font-bold capitalize">
                    {confirmLabel}
                  </span>
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function AlreadyRegisteredScreen({ loginUrl, onBack }: { loginUrl: string; onBack: () => void }) {
  return (
    <div className="px-5 md:px-8 pt-8 md:pt-12 lg:pt-16 pb-12 md:pb-16">
      <h1 className="text-[26px] sm:text-3xl md:text-4xl lg:text-[44px] font-extrabold tracking-tight text-white">
        Ese email ya tiene cuenta
      </h1>
      <p className="mt-4 text-[15px] md:text-base lg:text-lg text-white/80 leading-relaxed">
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
                   border border-white/15 text-white/85 font-medium
                   active:scale-[0.98] transition"
      >
        ← Usar otro email
      </button>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-baseline gap-3">
      <div className="text-[12px] uppercase tracking-[0.14em] text-white/50 w-20 shrink-0">
        {label}
      </div>
      <div className="text-[15px] text-white font-medium">
        {value ?? "—"}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-[12px] uppercase tracking-[0.14em] text-white/55 mb-1.5">
        {label}
      </div>
      {children}
    </label>
  );
}
