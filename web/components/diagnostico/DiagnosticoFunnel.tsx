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

type Answers = {
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

type Step = 1 | 2 | 3 | 4 | "low_budget_exit" | 5 | 6;

export function DiagnosticoFunnel() {
  const [step, setStep]       = useState<Step>(1);
  const [answers, setAnswers] = useState<Answers>({
    level: null, goal: null, urgency: null, budget: null,
  });
  const [form, setForm] = useState<FormData>({
    name: "", email: "", whatsapp: "", countryCode: "+34", country: "ES", gdpr: false,
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitErr,  setSubmitErr]  = useState<string | null>(null);
  const [alreadyRegistered, setAlreadyRegistered] = useState<{ loginUrl: string } | null>(null);
  const [leadId,     setLeadId]     = useState<string | null>(null);

  // Theme color para la barra de estado en móvil
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.setAttribute("name", "theme-color");
    meta.setAttribute("content", "#0F2847");
    meta.setAttribute("data-diagnostico", "1");
    document.head.appendChild(meta);
    return () => { meta.remove(); };
  }, []);

  // Progreso visual — 5 pasos visibles (la pantalla SCHULE no cuenta)
  const visualStepNum =
    step === "low_budget_exit" ? 4 :
    step === 5 ? 5 :
    step === 6 ? 5 :
    step;
  const totalSteps = 5;
  const progressPct = (visualStepNum / totalSteps) * 100;

  // Handlers ────────────────────────────────────────────────────

  function pickLevel(id: typeof LEVEL_OPTIONS[number]["id"]) {
    setAnswers(a => ({ ...a, level: id }));
    setStep(2);
  }
  function pickGoal(id: typeof GOAL_OPTIONS[number]["id"]) {
    setAnswers(a => ({ ...a, goal: id }));
    setStep(3);
  }
  function pickUrgency(id: typeof URGENCY_OPTIONS[number]["id"]) {
    setAnswers(a => ({ ...a, urgency: id }));
    setStep(4);
  }
  function pickBudget(id: typeof BUDGET_OPTIONS[number]["id"], lowBudget: boolean) {
    setAnswers(a => ({ ...a, budget: id }));
    setStep(lowBudget ? "low_budget_exit" : 5);
  }

  function goBack() {
    if (step === 6) return; // no hay back desde resumen
    if (step === 5) setStep(4);
    else if (step === "low_budget_exit") setStep(4);
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
      // Normalizar whatsapp a E.164: countryCode + dígitos locales
      const localDigits = form.whatsapp.replace(/\D/g, "");
      const whatsappE164 = `${form.countryCode.startsWith("+") ? form.countryCode : "+" + form.countryCode}${localDigits}`;

      const body = {
        name:          form.name.trim(),
        email:         form.email.trim().toLowerCase(),
        whatsapp_e164: whatsappE164,
        country:       form.country,
        language:      "es",
        gdpr_accepted: true,
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
      setStep(6);
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
        <div className="mx-auto max-w-xl flex items-center justify-between gap-2 h-14 px-3">
          <button
            type="button"
            onClick={goBack}
            disabled={step === 1 || step === 6}
            className="h-10 w-10 inline-flex items-center justify-center rounded-full
                       text-white/85 hover:bg-white/10 active:scale-95 transition
                       disabled:opacity-30 disabled:active:scale-100"
            aria-label="Paso anterior"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-white/70">
            {step === "low_budget_exit"
              ? "Resultado"
              : step === 6
                ? "Tu plan"
                : `Paso ${visualStepNum} de ${totalSteps}`}
          </div>
          <div className="h-10 w-10" />
        </div>
        <div className="h-0.5 bg-white/5">
          <div
            className="h-full bg-warm transition-[width] duration-300 ease-out"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </header>

      <main className="flex-1 mx-auto w-full max-w-xl">
        {step === 1 && (
          <QuizStep
            title="¿Cuál es tu nivel actual de alemán?"
            options={LEVEL_OPTIONS.map(o => ({ id: o.id, label: o.id, emoji: o.emoji }))}
            selected={answers.level}
            onPick={(id) => pickLevel(id as typeof LEVEL_OPTIONS[number]["id"])}
          />
        )}
        {step === 2 && (
          <QuizStep
            title="¿Para qué necesitas el alemán?"
            options={GOAL_OPTIONS.map(o => ({ id: o.id, label: o.id, emoji: o.emoji }))}
            selected={answers.goal}
            onPick={(id) => pickGoal(id as typeof GOAL_OPTIONS[number]["id"])}
          />
        )}
        {step === 3 && (
          <QuizStep
            title="¿En cuánto tiempo quieres alcanzar tu objetivo?"
            options={URGENCY_OPTIONS.map(o => ({ id: o.id, label: o.id, emoji: o.emoji }))}
            selected={answers.urgency}
            onPick={(id) => pickUrgency(id as typeof URGENCY_OPTIONS[number]["id"])}
          />
        )}
        {step === 4 && (
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
        {step === "low_budget_exit" && <LowBudgetExit onBack={() => setStep(4)} />}
        {step === 5 && (
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
        {step === 6 && leadId && (
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

function QuizStep({
  title, options, selected, onPick,
}: {
  title: string;
  options: { id: string; label: string; emoji: string }[];
  selected: string | null;
  onPick: (id: string) => void;
}) {
  return (
    <div className="px-5 pt-6 pb-12">
      <h1 className="text-[26px] sm:text-3xl font-extrabold tracking-tight text-white">
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
                className={`w-full flex items-center gap-3 px-4 h-16 rounded-2xl
                            text-left text-white font-medium
                            border transition active:scale-[0.99]
                            ${isSelected
                              ? "border-warm bg-warm/15"
                              : "border-white/10 bg-white/5 hover:bg-white/10"}`}
              >
                <span className="text-2xl" aria-hidden>{opt.emoji}</span>
                <span className="text-[15px] leading-snug">{opt.label}</span>
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
    <div className="px-5 pt-8 pb-12">
      <h1 className="text-[26px] sm:text-3xl font-extrabold tracking-tight text-white">
        Gracias por contarnos tu situación
      </h1>
      <p className="mt-4 text-[15px] text-white/80 leading-relaxed">
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
      <h1 className="text-[26px] sm:text-3xl font-extrabold tracking-tight text-white">
        ¡Estamos creando tu plan!
      </h1>
      <p className="mt-2 text-[15px] text-white/70 leading-relaxed">
        Para enviártelo y agendar tu clase de prueba, necesitamos tus datos:
      </p>

      <div className="mt-6 space-y-4">
        <Field label="Nombre completo">
          <input
            type="text"
            autoComplete="name"
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            className="w-full h-12 px-4 rounded-xl bg-white/5 border border-white/10
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
            className="w-full h-12 px-4 rounded-xl bg-white/5 border border-white/10
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
              className="w-20 h-12 px-3 rounded-xl bg-white/5 border border-white/10
                         text-white text-center
                         focus:outline-none focus:border-warm focus:bg-white/10"
              placeholder="+34"
            />
            <input
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={form.whatsapp}
              onChange={e => setForm(f => ({ ...f, whatsapp: e.target.value }))}
              className="flex-1 h-12 px-4 rounded-xl bg-white/5 border border-white/10
                         text-white placeholder:text-white/40
                         focus:outline-none focus:border-warm focus:bg-white/10"
              placeholder="611 22 33 44"
            />
          </div>
        </Field>

        <Field label="País de residencia">
          <select
            value={form.country}
            onChange={e => setForm(f => ({ ...f, country: e.target.value }))}
            className="w-full h-12 px-3 rounded-xl bg-white/5 border border-white/10
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
        <div className="mx-auto max-w-xl px-5 pb-4"
             style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1rem)" }}>
          <button
            type="button"
            onClick={onSubmit}
            disabled={!canSubmit}
            className="w-full h-12 rounded-2xl bg-warm text-warm-foreground font-semibold text-base
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

  const onPickSlot = async (s: SlotItem) => {
    if (submitting) return;
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

      const localDigits  = form.whatsapp.replace(/\D/g, "");
      const cc           = form.countryCode.startsWith("+") ? form.countryCode : `+${form.countryCode}`;
      const whatsappE164 = `${cc}${localDigits}`;

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
      firePixelSchedule({ leadId });
      try {
        sessionStorage.removeItem("b2c.agendar.v1");
        sessionStorage.removeItem("diagnostico_lead_id");
        sessionStorage.removeItem("diagnostico_name");
        sessionStorage.removeItem("diagnostico_email");
      } catch { /* ignore */ }
      if (typeof window !== "undefined") window.location.href = "/confirmacion";
    } catch (e) {
      console.error("[diagnostico] book-trial failed:", e);
      setSubmitErr("Error de conexión. Inténtalo de nuevo.");
      setSubmitting(false);
    }
  };

  return (
    <div className="px-5 pt-6 pb-12">
      <h1 className="text-[26px] sm:text-3xl font-extrabold tracking-tight text-white">
        ¡Tu plan está listo, {name}!
      </h1>

      <div className="mt-5 rounded-2xl border border-white/10 bg-white/5 p-4 space-y-2.5">
        <SummaryRow label="Nivel"    value={answers.level} />
        <SummaryRow label="Objetivo" value={answers.goal} />
        <SummaryRow label="Plazo"    value={answers.urgency} />
      </div>

      <p className="mt-6 text-[15px] text-white/85 leading-relaxed">
        Reserva ahora tu clase de prueba <strong>GRATIS de 30 min</strong> con un profesor nativo:
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
                  selectedIso={null}
                  selectedTeacherId={null}
                  onSelect={onPickSlot}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function AlreadyRegisteredScreen({ loginUrl, onBack }: { loginUrl: string; onBack: () => void }) {
  return (
    <div className="px-5 pt-8 pb-12">
      <h1 className="text-[26px] sm:text-3xl font-extrabold tracking-tight text-white">
        Ese email ya tiene cuenta
      </h1>
      <p className="mt-4 text-[15px] text-white/80 leading-relaxed">
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
