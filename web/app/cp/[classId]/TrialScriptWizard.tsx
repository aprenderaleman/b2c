"use client";

import { useState, useTransition, useEffect, useMemo, useCallback } from "react";
import { saveStepAction, completeAttendedAction, completeAbsentAction } from "./actions";
import { TRIAL_PACKS, recommendPacks, getPack, type PackId, type PaymentType } from "@/lib/trial-packs";
import type { ScriptRow, ClassContext } from "@/lib/trial-script";

/**
 * Wizard de 8 pasos para el profesor durante la clase de prueba.
 *
 * Estado:
 *   - El padre carga el script existente (initial) — el wizard arranca
 *     en initial.current_step.
 *   - Cada "Siguiente" persiste el patch del paso actual + el nuevo
 *     current_step. Si el profe cierra la pestaña a mitad, al volver
 *     a abrir /cp/[classId] retoma donde iba.
 *   - Los botones finales (Asistió/No asistió) llaman a acciones que
 *     atan con markTrialAttendedAwaitingConversion / markTrialAbsent
 *     en lib/admin-actions.ts.
 *
 * Plan de tiempos sugerido (Gelfis 2026-06-08):
 *   intro 5 min · clase 15 min · cierre 10 min · total 30 min.
 *   El temporizador del Paso 2 es solo guía, no bloquea avanzar.
 */
export function TrialScriptWizard({
  scriptId, classCtx, initial,
}: {
  scriptId: string;
  classCtx: ClassContext;
  initial:  ScriptRow;
}) {
  const [step, setStep] = useState<number>(initial.current_step || 1);
  const [pending, startTransition] = useTransition();

  // Outcome global — si el profe marca "No asistio" desde el header
  // (atajo disponible en TODOS los pasos), o si lo marca al final, el
  // wizard pinta la pantalla de cierre en vez del paso actual. Esto
  // evita que tenga que recorrer los 8 pasos si el lead nunca aparece.
  const [outcome, setOutcome] = useState<"attended" | "absent" | null>(
    (initial.final_outcome as "attended" | "absent" | null) ?? null,
  );
  const [absentPending, setAbsentPending] = useState(false);
  const [absentErr, setAbsentErr] = useState<string | null>(null);

  // Campos del script — controlados localmente, persistidos al pulsar Siguiente.
  const [objetivo,       setObjetivo]       = useState(initial.objetivo       ?? "");
  const [nivelObjetivo,  setNivelObjetivo]  = useState(initial.nivel_objetivo ?? "");
  const [deadline,       setDeadline]       = useState(initial.deadline       ?? "");
  const [motivacion,     setMotivacion]     = useState(initial.motivacion     ?? "");

  const [feedbackClase,  setFeedbackClase]  = useState(initial.feedback_clase ?? "");
  const [feedbackGusto,  setFeedbackGusto]  = useState(initial.feedback_gusto ?? "");
  const [enrollmentSense, setEnrollmentSense] = useState<boolean | null>(initial.enrollment_sense);

  const [objectionReason,  setObjectionReason]  = useState(initial.objection_reason  ?? "");
  const [objectionUnblock, setObjectionUnblock] = useState(initial.objection_unblock ?? "");

  const [scheduleType, setScheduleType] = useState<"fixed" | "changing" | "">(
    initial.schedule_type ?? "",
  );
  const [learningGoal, setLearningGoal] = useState<"one_level" | "confidence" | "">(
    initial.learning_goal ?? "",
  );

  const [chosenPack,  setChosenPack]  = useState<PackId | "">(initial.chosen_pack ?? "");
  const [paymentType, setPaymentType] = useState<PaymentType | "">(initial.payment_type ?? "");
  const [closingYes,  setClosingYes]  = useState<boolean | null>(initial.closing_yes);

  const [teacherNotes, setTeacherNotes] = useState(initial.teacher_notes ?? "");
  const [error,        setError]        = useState<string | null>(null);

  // Packs recomendados según filtros del paso 4.
  const recommendedPacks: PackId[] | null = useMemo(() => {
    if (!scheduleType || !learningGoal) return null;
    return recommendPacks(scheduleType, learningGoal);
  }, [scheduleType, learningGoal]);

  // Si scheduleType cambia a 'changing', learningGoal NO bloquea la
  // recomendación (los 2 packs individuales son siempre los mismos).
  // Para mantener consistencia del filtro, exigimos ambos campos.

  const advance = (to: number, patch: Record<string, unknown>) => {
    setError(null);
    startTransition(async () => {
      try {
        await saveStepAction(scriptId, { ...patch, current_step: to });
        setStep(to);
        window.scrollTo({ top: 0, behavior: "smooth" });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error al guardar.");
      }
    });
  };

  // Mapa de "atrás" por paso. step-1 simple no sirve porque hay
  // ramas (paso 3 puede llevar a 3.5 si dijo NO, o a 4 si dijo SÍ;
  // paso 8 puede venir de 3.5 o de 7). Lo definimos explícito.
  const previousStep = (cur: number): number | null => {
    if (cur === 8)   return enrollmentSense === false ? 3.5 : 7;
    if (cur === 7)   return 6;
    if (cur === 6)   return 5;
    if (cur === 5)   return 4;
    if (cur === 4)   return 3;
    if (cur === 3.5) return 3;
    if (cur === 3)   return 2;
    if (cur === 2)   return 1;
    return null;  // paso 1 no tiene anterior
  };

  const goBack = () => {
    const prev = previousStep(step);
    if (prev !== null) setStep(prev);
    setError(null);
  };

  // Atajo global "No asistio" — visible en TODOS los pasos desde el
  // header. Para que el profe no tenga que recorrer 8 pasos cuando el
  // lead jamas aparecio en la clase. Pide confirmacion porque dispara
  // la cadena de follow-ups y marca el script como cerrado.
  const onQuickAbsent = useCallback(() => {
    if (!confirm("¿Marcar al lead como NO ASISTIÓ?\n\n" +
      "• El sistema activa la cadena de re-toques automáticos.\n" +
      "• Esta pantalla del guion se cierra.\n\n" +
      "¿Continuar?")) return;
    setAbsentErr(null);
    setAbsentPending(true);
    (async () => {
      try {
        await completeAbsentAction({
          scriptId,
          leadId:       classCtx.leadId,
          teacherNotes: "",
        });
        setOutcome("absent");
      } catch (e) {
        setAbsentErr(e instanceof Error ? e.message : "Error al marcar.");
      } finally {
        setAbsentPending(false);
      }
    })();
  }, [scriptId, classCtx.leadId]);

  // Cronómetro del Paso 2 (visual, no bloquea).
  const TimerBar = step === 2 ? <ClassTimer /> : null;

  // Si ya hay outcome (marcado desde header o desde paso 8), pintamos
  // la pantalla de cierre en vez del paso actual.
  if (outcome === "absent") {
    return (
      <div className="max-w-3xl mx-auto">
        <FinalDone
          title="❌ Marcado como no asistió"
          body="La cadena de re-toques se activa automáticamente. Puedes cerrar esta pestaña."
        />
      </div>
    );
  }
  if (outcome === "attended") {
    return (
      <div className="max-w-3xl mx-auto">
        <FinalDone
          title="✅ Asistió — todo registrado"
          body="El lead ha recibido el WhatsApp con el enlace de pago. Stiv hace el seguimiento."
        />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto">
      <LeadHeader
        ctx={classCtx} stepNum={step} totalSteps={8}
        onQuickAbsent={onQuickAbsent}
        absentPending={absentPending}
      />
      {absentErr && (
        <div className="mt-2 rounded-lg bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 px-3 py-2 text-sm text-rose-700 dark:text-rose-300">
          {absentErr}
        </div>
      )}
      {TimerBar}

      <div className="mt-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-sm p-6 md:p-8">
        {step === 1 && (
          <Step1Discovery
            objetivo={objetivo}      setObjetivo={setObjetivo}
            nivelObjetivo={nivelObjetivo} setNivelObjetivo={setNivelObjetivo}
            deadline={deadline}      setDeadline={setDeadline}
            motivacion={motivacion}  setMotivacion={setMotivacion}
          />
        )}

        {step === 2 && (
          <Step2Demo />
        )}

        {step === 3 && (
          <Step3PostDemo
            objetivo={objetivo}
            feedbackClase={feedbackClase}  setFeedbackClase={setFeedbackClase}
            feedbackGusto={feedbackGusto}  setFeedbackGusto={setFeedbackGusto}
            enrollmentSense={enrollmentSense} setEnrollmentSense={setEnrollmentSense}
          />
        )}

        {step === 3.5 && (
          <Step3bObjection
            objectionReason={objectionReason}   setObjectionReason={setObjectionReason}
            objectionUnblock={objectionUnblock} setObjectionUnblock={setObjectionUnblock}
          />
        )}

        {step === 4 && (
          <Step4Filters
            scheduleType={scheduleType} setScheduleType={setScheduleType}
            learningGoal={learningGoal} setLearningGoal={setLearningGoal}
          />
        )}

        {step === 5 && recommendedPacks && (
          <Step5Packs
            packs={recommendedPacks}
            chosenPack={chosenPack}
            setChosenPack={setChosenPack}
          />
        )}

        {step === 6 && (
          <Step6Payment
            paymentType={paymentType}
            setPaymentType={setPaymentType}
          />
        )}

        {step === 7 && (
          <Step7Closing
            closingYes={closingYes}
            setClosingYes={setClosingYes}
          />
        )}

        {step === 8 && (
          <Step8Final
            classCtx={classCtx}
            scriptId={scriptId}
            chosenPack={chosenPack as PackId}
            paymentType={paymentType as PaymentType}
            objetivo={objetivo}
            teacherNotes={teacherNotes}
            setTeacherNotes={setTeacherNotes}
            pending={pending}
            onBack={goBack}
          />
        )}

        {error && (
          <div className="mt-4 rounded-lg bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 px-3 py-2 text-sm text-rose-700 dark:text-rose-300">
            {error}
          </div>
        )}

        {step !== 8 && (
          <NavRow
            step={step}
            pending={pending}
            onBack={previousStep(step) !== null ? goBack : "/admin/clasedeprueba"}
            onNext={() => {
              // Routing de pasos + payload por paso.
              if (step === 1) {
                if (!objetivo.trim()) { setError("El objetivo es obligatorio."); return; }
                advance(2, { objetivo, nivel_objetivo: nivelObjetivo, deadline, motivacion });
              } else if (step === 2) {
                advance(3, {});
              } else if (step === 3) {
                if (enrollmentSense === null) { setError("Marca sí o no en la última pregunta."); return; }
                if (enrollmentSense === false) {
                  advance(3.5, { feedback_clase: feedbackClase, feedback_gusto: feedbackGusto, enrollment_sense: false });
                } else {
                  advance(4,   { feedback_clase: feedbackClase, feedback_gusto: feedbackGusto, enrollment_sense: true });
                }
              } else if (step === 3.5) {
                // Tras manejar objeción, ofrecemos reintentar el cierre.
                // Si el lead no cambió de opinión, el profe pulsa
                // directamente "No asistió" en paso 8 — saltamos packs.
                advance(8, { objection_reason: objectionReason, objection_unblock: objectionUnblock });
              } else if (step === 4) {
                if (!scheduleType || !learningGoal) { setError("Responde los 2 filtros."); return; }
                advance(5, { schedule_type: scheduleType, learning_goal: learningGoal,
                            presented_packs: recommendPacks(scheduleType, learningGoal) });
              } else if (step === 5) {
                if (!chosenPack) { setError("Selecciona el pack que el lead eligió."); return; }
                advance(6, { chosen_pack: chosenPack });
              } else if (step === 6) {
                if (!paymentType) { setError("Selecciona tipo de pago."); return; }
                advance(7, { payment_type: paymentType });
              } else if (step === 7) {
                if (closingYes === null) { setError("Marca sí o no."); return; }
                advance(8, { closing_yes: closingYes });
              }
            }}
          />
        )}
      </div>

      <ProgressDots step={step} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Layout helpers
// ─────────────────────────────────────────────────────────────────

function LeadHeader({
  ctx, stepNum, totalSteps, onQuickAbsent, absentPending,
}: {
  ctx: ClassContext; stepNum: number; totalSteps: number;
  onQuickAbsent: () => void; absentPending: boolean;
}) {
  const stepLabel = stepNum === 3.5 ? "3b" : String(stepNum);
  return (
    <header className="rounded-2xl bg-gradient-to-br from-emerald-500/10 to-amber-500/10 border border-emerald-300/30 px-4 py-3 flex items-start justify-between gap-3 flex-wrap">
      <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
          Clase de prueba · Paso {stepLabel} de {totalSteps}
        </div>
        <div className="mt-0.5 text-base font-bold text-slate-900 dark:text-slate-50">
          {ctx.lead.name ?? "(sin nombre)"} · nivel {ctx.lead.germanLevel ?? "?"} · {ctx.lead.language === "de" ? "🇩🇪 alemán" : "🇪🇸 español"}
        </div>
        <div className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
          Motivo inicial: {ctx.lead.motivo ?? "—"} · Profe: {ctx.teacherName ?? "—"}
        </div>
      </div>
      <div className="shrink-0 flex items-center gap-1.5">
        {ctx.lead.whatsapp && (
          <a
            href={`https://wa.me/${ctx.lead.whatsapp.replace(/[^\d]/g, "")}`}
            target="_blank" rel="noreferrer"
            className="text-xs font-semibold rounded-full border border-emerald-300 bg-emerald-100 px-3 py-1.5 text-emerald-800 hover:bg-emerald-200"
            title="Abrir WhatsApp del lead"
          >
            💬 WhatsApp
          </a>
        )}
        {/* Atajo "No asistio" disponible en TODOS los pasos. Si el
            lead nunca aparecio, el profe no tiene que recorrer 8
            pasos antes de marcarlo. Cierra el guion al instante. */}
        <button
          type="button"
          onClick={onQuickAbsent}
          disabled={absentPending}
          className="text-xs font-semibold rounded-full border border-amber-400 bg-amber-100 dark:bg-amber-500/15 px-3 py-1.5 text-amber-900 dark:text-amber-200 hover:bg-amber-200 dark:hover:bg-amber-500/25 disabled:opacity-50"
          title="Marcar al lead como NO ASISTIÓ (atajo desde cualquier paso)"
        >
          {absentPending ? "Marcando..." : "❌ No asistió"}
        </button>
      </div>
    </header>
  );
}

function ClassTimer() {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    const i = setInterval(() => setSecs(s => s + 1), 1000);
    return () => clearInterval(i);
  }, []);
  const mm = String(Math.floor(secs / 60)).padStart(2, "0");
  const ss = String(secs % 60).padStart(2, "0");
  return (
    <div className="mt-3 rounded-xl bg-amber-100/60 dark:bg-amber-500/10 border border-amber-300/40 px-4 py-2 flex items-center justify-between">
      <span className="text-sm text-amber-900 dark:text-amber-200">
        ⏱ Demo en curso · objetivo ~15 min (clase) — guía visual, no bloquea
      </span>
      <span className="text-xl font-mono font-bold text-amber-900 dark:text-amber-200 tabular-nums">
        {mm}:{ss}
      </span>
    </div>
  );
}

function NavRow({
  step, pending, onBack, onNext,
}: {
  step: number; pending: boolean;
  /** Si es función → handler de "Atrás" dentro del wizard.
   *  Si es string → href absoluto (ej. salir del wizard). */
  onBack?: (() => void) | string;
  onNext: () => void;
}) {
  return (
    <div className="mt-6 flex items-center justify-between">
      {typeof onBack === "function" ? (
        <button
          type="button"
          onClick={onBack}
          disabled={pending}
          className="text-sm rounded-full border border-slate-300 dark:border-slate-600 px-4 py-2 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
        >
          ← Atrás
        </button>
      ) : typeof onBack === "string" ? (
        <a
          href={onBack}
          className="text-sm rounded-full border border-slate-300 dark:border-slate-600 px-4 py-2 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          ← Salir
        </a>
      ) : <span />}
      <button
        type="button"
        onClick={onNext}
        disabled={pending}
        className="text-sm font-semibold rounded-full bg-emerald-500 text-white px-6 py-2 hover:bg-emerald-600 disabled:opacity-50"
      >
        {pending ? "Guardando..." : step === 7 ? "Ir al cierre" : "Siguiente →"}
      </button>
    </div>
  );
}

function ProgressDots({ step }: { step: number }) {
  const visualStep = Math.ceil(step);
  return (
    <div className="mt-4 flex items-center justify-center gap-1.5">
      {[1, 2, 3, 4, 5, 6, 7, 8].map(n => (
        <span
          key={n}
          className={`h-1.5 rounded-full transition-all ${
            n === visualStep
              ? "w-8 bg-emerald-500"
              : n < visualStep
                ? "w-2 bg-emerald-300"
                : "w-2 bg-slate-300 dark:bg-slate-700"
          }`}
        />
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Steps
// ─────────────────────────────────────────────────────────────────

function Step1Discovery({
  objetivo, setObjetivo, nivelObjetivo, setNivelObjetivo,
  deadline, setDeadline, motivacion, setMotivacion,
}: {
  objetivo: string; setObjetivo: (v: string) => void;
  nivelObjetivo: string; setNivelObjetivo: (v: string) => void;
  deadline: string; setDeadline: (v: string) => void;
  motivacion: string; setMotivacion: (v: string) => void;
}) {
  return (
    <div>
      <StepTitle
        emoji="🎯"
        title="Discovery (5 min — antes de la demo)"
        hint="Habla con el lead, captura los 4 datos. Estas respuestas las usaremos para personalizar el cierre."
      />
      <Field label="¿Cuál es tu objetivo con el alemán?" required>
        <textarea value={objetivo} onChange={e => setObjetivo(e.target.value)} rows={2}
          placeholder='Ej: "Mudarme a Berlín en 6 meses para trabajar como enfermera"'
          className="input-text w-full" />
      </Field>
      <Field label="¿Qué nivel necesitas alcanzar?">
        <input value={nivelObjetivo} onChange={e => setNivelObjetivo(e.target.value)}
          placeholder="Ej: B2 para reconocimiento del título"
          className="input-text w-full" />
      </Field>
      <Field label="¿Para cuándo?">
        <input value={deadline} onChange={e => setDeadline(e.target.value)}
          placeholder='Ej: "Septiembre 2026"'
          className="input-text w-full" />
      </Field>
      <Field label="¿Qué lograrías cuando alcances ese objetivo? (motivación)">
        <textarea value={motivacion} onChange={e => setMotivacion(e.target.value)} rows={2}
          placeholder='Ej: "Empezar mi trabajo y reunirme con mi pareja"'
          className="input-text w-full" />
      </Field>
    </div>
  );
}

function Step2Demo() {
  return (
    <div>
      <StepTitle
        emoji="🎬"
        title="Demo (15 min)"
        hint="Da la clase de demostración. Cuando termines, pulsa 'Siguiente' para pasar al cierre."
      />
      <div className="rounded-xl bg-slate-100 dark:bg-slate-800 p-5 text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
        <p className="font-semibold text-slate-900 dark:text-slate-100">
          Recordatorio del esquema:
        </p>
        <ul className="mt-2 space-y-1 list-disc list-inside">
          <li>Demuestra el método, no solo enseñes vocabulario.</li>
          <li>Conecta con el objetivo que captaste en el Paso 1.</li>
          <li>Mantén el ritmo: ~15 min de demo, no más.</li>
        </ul>
      </div>
    </div>
  );
}

function Step3PostDemo({
  objetivo, feedbackClase, setFeedbackClase, feedbackGusto, setFeedbackGusto,
  enrollmentSense, setEnrollmentSense,
}: {
  objetivo: string;
  feedbackClase: string; setFeedbackClase: (v: string) => void;
  feedbackGusto: string; setFeedbackGusto: (v: string) => void;
  enrollmentSense: boolean | null; setEnrollmentSense: (v: boolean) => void;
}) {
  const objetivoQuoted = objetivo.trim() ? `"${objetivo.trim()}"` : "tu objetivo";
  return (
    <div>
      <StepTitle
        emoji="💬"
        title="Post-demo · feedback del lead"
        hint="Pregunta literal estas tres. Anota la respuesta del lead — más fiel mejor."
      />
      <Field label="¿Qué te ha parecido la clase?">
        <textarea value={feedbackClase} onChange={e => setFeedbackClase(e.target.value)} rows={2}
          placeholder="Su respuesta tal como la dijo." className="input-text w-full" />
      </Field>
      <Field label="¿Qué fue lo que más te gustó?">
        <textarea value={feedbackGusto} onChange={e => setFeedbackGusto(e.target.value)} rows={2}
          placeholder="Lo que más le impactó (lo usaremos en el cierre)." className="input-text w-full" />
      </Field>
      <Field
        label={`¿Tendría sentido para ti inscribirte en la academia para tomar clases semanales y lograr ${objetivoQuoted}?`}
        required
      >
        <div className="grid grid-cols-2 gap-2 mt-1">
          <YesNoButton active={enrollmentSense === true}  onClick={() => setEnrollmentSense(true)}  label="✅ Sí, tiene sentido" />
          <YesNoButton active={enrollmentSense === false} onClick={() => setEnrollmentSense(false)} label="❌ No" />
        </div>
      </Field>
    </div>
  );
}

function Step3bObjection({
  objectionReason, setObjectionReason, objectionUnblock, setObjectionUnblock,
}: {
  objectionReason:  string; setObjectionReason:  (v: string) => void;
  objectionUnblock: string; setObjectionUnblock: (v: string) => void;
}) {
  return (
    <div>
      <StepTitle
        emoji="🤔"
        title="Manejo de objeción"
        hint="El lead dijo que no le tiene sentido. Antes de cerrar, captura el motivo real para que el equipo aprenda."
      />
      <Field label="¿Qué te frena? / ¿Por qué crees que no?" required>
        <textarea value={objectionReason} onChange={e => setObjectionReason(e.target.value)} rows={3}
          placeholder='Ej: "el precio", "tengo poco tiempo", "ya estoy con otra academia"...'
          className="input-text w-full" />
      </Field>
      <Field label="¿Qué necesitarías para verlo natural / sentirte cómodo de empezar?">
        <textarea value={objectionUnblock} onChange={e => setObjectionUnblock(e.target.value)} rows={3}
          placeholder='Ej: "saber el precio exacto", "probar 1 semana", "consultarlo con mi pareja"...'
          className="input-text w-full" />
      </Field>
      <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
        Tras esto saltarás al cierre. Si el lead cambia de opinión, marca "✅ Asistió" igual e indícalo
        en notas — Stiv le hace seguimiento. Si no, marca "❌ No asistió" o cierra con cordialidad.
      </p>
    </div>
  );
}

function Step4Filters({
  scheduleType, setScheduleType, learningGoal, setLearningGoal,
}: {
  scheduleType: "fixed" | "changing" | ""; setScheduleType: (v: "fixed" | "changing") => void;
  learningGoal: "one_level" | "confidence" | ""; setLearningGoal: (v: "one_level" | "confidence") => void;
}) {
  return (
    <div>
      <StepTitle
        emoji="🎚"
        title="Filtros antes de presentar packs"
        hint="Estas 2 respuestas deciden qué 2 packs aparecen. Sé fiel a lo que dice el lead."
      />
      <Field label="¿Tienes horarios fijos cada semana o te cambian?" required>
        <div className="grid grid-cols-2 gap-2 mt-1">
          <YesNoButton active={scheduleType === "fixed"}    onClick={() => setScheduleType("fixed")}    label="🗓 Horarios fijos" />
          <YesNoButton active={scheduleType === "changing"} onClick={() => setScheduleType("changing")} label="🔀 Cambiantes" />
        </div>
      </Field>
      <Field label="¿Tu objetivo es lograr un nivel concreto o hablar alemán con confianza?" required>
        <div className="grid grid-cols-2 gap-2 mt-1">
          <YesNoButton active={learningGoal === "one_level"}  onClick={() => setLearningGoal("one_level")}  label="🎯 Un nivel concreto" />
          <YesNoButton active={learningGoal === "confidence"} onClick={() => setLearningGoal("confidence")} label="💬 Hablar con confianza" />
        </div>
      </Field>
      <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
        Horarios cambiantes → solo packs individuales. Horarios fijos +
        1 nivel → Pack Inicio. Horarios fijos + confianza → Pack Fluidez Total.
      </p>
    </div>
  );
}

function Step5Packs({
  packs, chosenPack, setChosenPack,
}: {
  packs: PackId[];
  chosenPack: PackId | "";
  setChosenPack: (v: PackId) => void;
}) {
  return (
    <div>
      <StepTitle
        emoji="📦"
        title="Presenta estos 2 packs · que elija uno"
        hint="Léelos con voz propia. Pide al lead que elija el que más le encaje."
      />
      <div className="grid md:grid-cols-2 gap-3 mt-3">
        {packs.map(pid => {
          const p = getPack(pid);
          if (!p) return null;
          return (
            <button
              key={pid}
              type="button"
              onClick={() => setChosenPack(pid)}
              className={`text-left rounded-2xl p-4 border-2 transition ${
                chosenPack === pid
                  ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-500/10"
                  : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-emerald-300"
              }`}
            >
              <div className="font-bold text-slate-900 dark:text-slate-50">{p.name}</div>
              {chosenPack === pid && (
                <div className="mt-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300">✓ Eligió este</div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Step6Payment({
  paymentType, setPaymentType,
}: {
  paymentType: PaymentType | ""; setPaymentType: (v: PaymentType) => void;
}) {
  return (
    <div>
      <StepTitle
        emoji="💳"
        title="¿Cómo prefiere pagar?"
        hint="Pago único = descuento por anticipado. Flexible = mensualidades."
      />
      <div className="grid grid-cols-2 gap-3 mt-3">
        {(["single", "flexible"] as const).map(t => (
          <button
            key={t}
            type="button"
            onClick={() => setPaymentType(t)}
            className={`rounded-2xl p-5 border-2 text-center transition ${
              paymentType === t
                ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-500/10"
                : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-emerald-300"
            }`}
          >
            <div className="text-2xl">{t === "single" ? "💰" : "🗓"}</div>
            <div className="mt-1 font-bold text-slate-900 dark:text-slate-50">
              {t === "single" ? "Pago único" : "Pago flexible"}
            </div>
            <div className="mt-1 text-xs text-slate-600 dark:text-slate-400">
              {t === "single" ? "Descuento por anticipado" : "Mensualidades"}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function Step7Closing({
  closingYes, setClosingYes,
}: {
  closingYes: boolean | null; setClosingYes: (v: boolean) => void;
}) {
  return (
    <div>
      <StepTitle
        emoji="🤝"
        title="Cierre"
        hint="Léelo literal. Tras la respuesta del lead, marca su decisión."
      />
      <div className="rounded-xl bg-gradient-to-br from-emerald-50 to-amber-50 dark:from-emerald-500/10 dark:to-amber-500/10 border border-emerald-200/60 dark:border-emerald-500/30 p-5 text-slate-800 dark:text-slate-100 leading-relaxed">
        <p className="text-base">
          "Hemos avanzado muy bien hoy. El siguiente paso es inscribirte
          formalmente en la academia.
        </p>
        <p className="mt-3 text-base font-semibold">
          ¿Tiene sentido para ti si te envío el enlace para que completes
          el pago mientras te voy inscribiendo en la academia?"
        </p>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <YesNoButton active={closingYes === true}  onClick={() => setClosingYes(true)}  label="✅ Sí, manda el enlace" />
        <YesNoButton active={closingYes === false} onClick={() => setClosingYes(false)} label="❌ No / dudoso" />
      </div>
    </div>
  );
}

function Step8Final({
  classCtx, scriptId, chosenPack, paymentType, objetivo, teacherNotes, setTeacherNotes, pending, onBack,
}: {
  classCtx: ClassContext;
  scriptId: string;
  chosenPack: PackId;
  paymentType: PaymentType;
  objetivo: string;
  teacherNotes: string;
  setTeacherNotes: (v: string) => void;
  pending: boolean;
  onBack: () => void;
}) {
  const [submitting, startTransition] = useTransition();
  const [done, setDone] = useState<"attended" | "absent" | null>(null);
  const [err, setErr]   = useState<string | null>(null);
  const busy = pending || submitting;

  const onAttended = () => {
    setErr(null);
    startTransition(async () => {
      try {
        await completeAttendedAction({
          scriptId,
          leadId:    classCtx.leadId,
          packId:    chosenPack,
          paymentType,
          objective: objetivo,
          teacherNotes,
        });
        setDone("attended");
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Error al marcar asistido.");
      }
    });
  };

  const onAbsent = () => {
    setErr(null);
    startTransition(async () => {
      try {
        await completeAbsentAction({ scriptId, leadId: classCtx.leadId, teacherNotes });
        setDone("absent");
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Error al marcar no asistió.");
      }
    });
  };

  if (done === "attended") {
    return (
      <FinalDone
        title="✅ Asistió — todo registrado"
        body="El lead ha recibido el WhatsApp con el enlace de pago. Stiv hace el seguimiento."
      />
    );
  }
  if (done === "absent") {
    return (
      <FinalDone
        title="❌ Marcado como no asistió"
        body="La cadena de re-toques se activa automáticamente. Puedes cerrar esta pestaña."
      />
    );
  }

  const hasFullPath = Boolean(chosenPack && paymentType);
  return (
    <div>
      <StepTitle
        emoji="🏁"
        title="Cierre del guion"
        hint="Marca el resultado. Esto envía el WhatsApp final al lead (si asistió) y graba la clase."
      />
      {!hasFullPath && (
        <div className="rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-300/40 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
          No completaste packs/pago (probablemente porque el lead dijo
          que no le tenía sentido). Marca "No asistió" o "Asistió" sin
          link (Stiv lo retomará).
        </div>
      )}
      <Field label="Notas del profe (opcional)">
        <textarea value={teacherNotes} onChange={e => setTeacherNotes(e.target.value)} rows={3}
          placeholder="Lo que quieras dejar registrado: actitud del lead, objeciones, observaciones..."
          className="input-text w-full" />
      </Field>
      <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button
          type="button"
          onClick={onAttended}
          disabled={busy || !hasFullPath}
          className="text-base font-bold rounded-xl bg-emerald-500 text-white px-5 py-3 hover:bg-emerald-600 disabled:opacity-50"
          title={!hasFullPath ? "Falta pack + tipo de pago para mandar el enlace" : "Asistió y enviar enlace de pago"}
        >
          {busy ? "Guardando..." : "✅ Asistió · enviar enlace"}
        </button>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onAbsent}
            disabled={busy}
            className="flex-1 text-base font-bold rounded-xl border border-amber-300 dark:border-amber-500/40 bg-amber-100 dark:bg-amber-500/15 text-amber-800 dark:text-amber-200 px-5 py-3 hover:bg-amber-200 dark:hover:bg-amber-500/25 disabled:opacity-50"
          >
            ❌ No asistió
          </button>
          {classCtx.lead.whatsapp && (
            <a
              href={`https://wa.me/${classCtx.lead.whatsapp.replace(/[^\d]/g, "")}`}
              target="_blank" rel="noreferrer"
              className="rounded-xl border border-emerald-300 bg-emerald-100 text-emerald-800 px-4 py-3 hover:bg-emerald-200 flex items-center justify-center"
              title="Mensajear al lead — comprobar problema técnico"
            >
              💬
            </a>
          )}
        </div>
      </div>
      {err && (
        <div className="mt-4 rounded-lg bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 px-3 py-2 text-sm text-rose-700 dark:text-rose-300">
          {err}
        </div>
      )}
      {/* Boton 'Atras' en paso 8 — corrige pack / pago / objetivo
          antes de enviar el WhatsApp con el enlace de pago. */}
      <div className="mt-5 flex justify-start">
        <button
          type="button"
          onClick={onBack}
          disabled={busy}
          className="text-sm rounded-full border border-slate-300 dark:border-slate-600 px-4 py-2 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
        >
          ← Atrás
        </button>
      </div>
    </div>
  );
}

function FinalDone({ title, body }: { title: string; body: string }) {
  return (
    <div className="text-center py-6">
      <div className="text-5xl">🎉</div>
      <h2 className="mt-3 text-xl font-bold text-slate-900 dark:text-slate-50">{title}</h2>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-400 max-w-md mx-auto">{body}</p>
      <button
        type="button"
        onClick={() => window.close()}
        className="mt-5 text-sm rounded-full border border-slate-300 dark:border-slate-600 px-4 py-2 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
      >
        Cerrar pestaña
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Primitives
// ─────────────────────────────────────────────────────────────────

function StepTitle({ emoji, title, hint }: { emoji: string; title: string; hint: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-xl md:text-2xl font-bold text-slate-900 dark:text-slate-50">
        {emoji} {title}
      </h2>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{hint}</p>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block mt-4">
      <span className="block text-sm font-medium text-slate-700 dark:text-slate-200">
        {label}{required && <span className="text-rose-500">  *</span>}
      </span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function YesNoButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl px-4 py-3 text-sm font-semibold transition border-2 ${
        active
          ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-900 dark:text-emerald-200"
          : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:border-emerald-300"
      }`}
    >
      {label}
    </button>
  );
}

// Fallback global para no depender de input-text del proyecto sin chequearlo.
// (Si .input-text ya existe en globals.css el atributo no choca — Tailwind
// solo añade clases si no chocan.)
declare global { /* eslint-disable @typescript-eslint/no-empty-object-type */
  // noop
}
// nada que exportar — los estilos van inline.
export {};
