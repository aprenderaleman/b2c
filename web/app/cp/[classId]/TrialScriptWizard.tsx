"use client";

import { useState, useTransition, useEffect, useCallback, useRef } from "react";
import { saveStepAction, completeAttendedAction, completeAbsentAction } from "./actions";
import { TRIAL_PACKS, getPack, type PackId, type PaymentType } from "@/lib/trial-packs";
import type { ScriptRow, ClassContext } from "@/lib/trial-script";

// ─────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────

const TOTAL_SECTIONS = 8; // 0-7

type LevelBucket = "A0" | "A1" | "A2" | "B1" | "B2" | "C1";

const LEVEL_PRESENTATION_URL: Record<LevelBucket, string> = {
  A0: "https://gamma.app/docs/8p0c89sshy99997",
  A1: "https://gamma.app/docs/v7w2wbdxd95n3sg",
  A2: "https://gamma.app/docs/ptfb8toca4msdav",
  B1: "https://gamma.app/docs/zooeusyqq9mrhw4",
  B2: "https://gamma.app/docs/ki7poj0542swdl2",
  C1: "https://gamma.app/docs/7kaqe967ge5a4ly",
};

const NIVEL_OPTIONS = ["A0", "A1", "A2", "B1", "B2", "C1", "C2"];

const DIFICULTAD_OPTIONS = [
  "Pronunciación",
  "Gramática (artículos, casos)",
  "Vocabulario",
  "Comprensión auditiva",
  "Hablar con fluidez",
  "Mantener constancia",
  "Encontrar tiempo para estudiar",
];

const PRESENTACION_CHECKS = [
  "Me presenté y generé rapport",
  "Expliqué la dinámica de la clase",
  "Pregunté si tiene preguntas antes de empezar",
];

const MINI_CLASE_CHECKS = [
  "El lead participó activamente",
  "Adapté el contenido a su nivel real",
  "Cerré la mini clase con un resumen de lo aprendido",
];

const CIERRE_Q1_OPTIONS = [
  "Sí, totalmente",
  "Sí, pero con dudas",
  "No mucho",
  "No",
];

const CIERRE_Q2_OPTIONS = [
  "Sí, totalmente",
  "Sí, creo que sí",
  "No estoy seguro",
  "No",
];

const CIERRE_Q3_OPTIONS = [
  "Sí, esta semana",
  "Sí, pero en 2-3 semanas",
  "Tengo que pensarlo",
  "No estoy listo",
];

const RESULTADO_OPTIONS = [
  "Pagó",
  "Dijo \"pago mañana\" / pagará después",
  "Dijo \"lo voy a pensar\"",
  "Dijo no por dinero",
  "Dijo no por tiempo",
  "Dijo no, no le interesa",
  "No respondió a la pregunta de cierre",
];

const RESULTADO_RAZONES_OPTIONS = [
  "Precio percibido como alto",
  "Necesita consultar con pareja/familia",
  "Tiene otra opción que está evaluando",
  "No tiene presupuesto ahora",
  "No quiere comprometerse 6 meses",
  "Horarios no encajan",
  "Quiere empezar más adelante",
  "No le convence el método",
];

function normalizeLevelBucket(level: string | null | undefined): LevelBucket | null {
  if (!level) return null;
  const l = level.toUpperCase();
  if (l.startsWith("A0")) return "A0";
  if (l.startsWith("A1")) return "A1";
  if (l.startsWith("A2")) return "A2";
  if (l.startsWith("B1")) return "B1";
  if (l.startsWith("B2")) return "B2";
  if (l.startsWith("C1")) return "C1";
  return null;
}

function isPositive(answer: string): boolean {
  return answer.startsWith("Sí");
}

// ─────────────────────────────────────────────────────────────────
// Main Wizard
// ─────────────────────────────────────────────────────────────────

export function TrialScriptWizard({
  scriptId, classCtx, initial,
}: {
  scriptId: string;
  classCtx: ClassContext;
  initial:  ScriptRow;
}) {
  const [step, setStep] = useState<number>(initial.current_step ?? 0);
  const [pending, startTransition] = useTransition();

  const [outcome, setOutcome] = useState<"attended" | "absent" | "converted" | null>(
    (initial.final_outcome as "attended" | "absent" | "converted" | null) ?? null,
  );
  const [absentPending, setAbsentPending] = useState(false);
  const [absentErr, setAbsentErr] = useState<string | null>(null);

  // Global timer — starts when teacher clicks "Comenzar clase" in section 0
  const [timerRunning, setTimerRunning] = useState(step > 0);
  const [globalSecs, setGlobalSecs] = useState(0);
  useEffect(() => {
    if (!timerRunning) return;
    const i = setInterval(() => setGlobalSecs(s => s + 1), 1000);
    return () => clearInterval(i);
  }, [timerRunning]);

  // ── Field state ──
  // Section 1
  const [presentacionChecks, setPresentacionChecks] = useState(initial.presentacion_checks ?? "");

  // Section 2
  const [objetivo, setObjetivo] = useState(initial.objetivo ?? "");
  const [nivelReal, setNivelReal] = useState(initial.nivel_objetivo ?? "");
  const [dificultades, setDificultades] = useState(initial.motivacion ?? "");
  const [dificultadOtra, setDificultadOtra] = useState("");

  // Section 3
  const [miniClaseChecks, setMiniClaseChecks] = useState(initial.mini_clase_checks ?? "");
  const [miniClaseObs, setMiniClaseObs] = useState(initial.mini_clase_obs ?? "");

  // Section 4
  const [cierreQ1, setCierreQ1] = useState(initial.cierre_q1 ?? "");
  const [cierreQ2, setCierreQ2] = useState(initial.cierre_q2 ?? "");
  const [cierreQ3, setCierreQ3] = useState(initial.cierre_q3 ?? "");

  // Section 6
  const [chosenPack, setChosenPack] = useState<string>(initial.chosen_pack ?? "");
  const [chosenPackOtro, setChosenPackOtro] = useState("");
  const [paymentType, setPaymentType] = useState<PaymentType | "">(initial.payment_type ?? "");
  const [wasSent, setWasSent] = useState(false);
  const [paymentConfirmed, setPaymentConfirmed] = useState<boolean | null>(initial.payment_confirmed ?? null);

  // Section 7
  const [resultado, setResultado] = useState(initial.resultado ?? "");
  const [resultadoOtro, setResultadoOtro] = useState("");
  const [resultadoRazones, setResultadoRazones] = useState(initial.resultado_razones ?? "");
  const [razonOtra, setRazonOtra] = useState("");
  const [teacherNotes, setTeacherNotes] = useState(initial.teacher_notes ?? "");

  const [error, setError] = useState<string | null>(null);

  // ── Floating notes panel ──
  const [notesOpen, setNotesOpen] = useState(false);
  const [floatingNotes, setFloatingNotes] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem(`cp_notes_${scriptId}`) ?? "";
    }
    return "";
  });
  const floatingNotesRef = useRef(floatingNotes);
  floatingNotesRef.current = floatingNotes;
  const [notesSaved, setNotesSaved] = useState(true);

  useEffect(() => {
    const i = setInterval(() => {
      if (typeof window !== "undefined") {
        localStorage.setItem(`cp_notes_${scriptId}`, floatingNotesRef.current);
        setNotesSaved(true);
      }
    }, 3000);
    return () => clearInterval(i);
  }, [scriptId]);

  // ── Navigation helpers ──
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

  const goBack = () => {
    if (step > 0) setStep(step - 1);
    setError(null);
  };

  // ── Quick absent ──
  const onQuickAbsent = useCallback(() => {
    if (!confirm("¿Marcar al lead como NO ASISTIÓ?\n\n• El sistema activa la cadena de re-toques automáticos.\n• Esta pantalla del guion se cierra.\n\n¿Continuar?")) return;
    setAbsentErr(null);
    setAbsentPending(true);
    (async () => {
      try {
        await completeAbsentAction({ scriptId, leadId: classCtx.leadId, teacherNotes: "" });
        setOutcome("absent");
      } catch (e) {
        setAbsentErr(e instanceof Error ? e.message : "Error al marcar.");
      } finally {
        setAbsentPending(false);
      }
    })();
  }, [scriptId, classCtx.leadId]);

  // ── Final screens ──
  if (outcome === "absent") {
    return (
      <div className="max-w-3xl mx-auto">
        <FinalDone title="Marcado como no asistió" body="La cadena de re-toques se activa automáticamente. Puedes cerrar esta pestaña." />
      </div>
    );
  }
  if (outcome === "attended" || outcome === "converted") {
    return (
      <div className="max-w-3xl mx-auto">
        <FinalDone
          title={outcome === "converted" ? "Pago confirmado — estudiante registrado" : "Asistió — link de pago enviado"}
          body={outcome === "converted"
            ? "El lead ha sido convertido a estudiante. Onboarding activado."
            : "El lead ha recibido el WhatsApp con el enlace de pago. Seguimiento automático activado."}
        />
      </div>
    );
  }

  const firstName = (classCtx.lead.name || "").split(/\s+/)[0] || "Lead";

  return (
    <div className="max-w-3xl mx-auto">
      <WizardHeader
        ctx={classCtx}
        stepNum={step}
        totalSteps={TOTAL_SECTIONS}
        globalSecs={timerRunning ? globalSecs : null}
        onQuickAbsent={onQuickAbsent}
        absentPending={absentPending}
      />
      {absentErr && <ErrorBar message={absentErr} />}

      <div className="mt-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-sm p-6 md:p-8">

        {step === 0 && (
          <Section0Prep ctx={classCtx} />
        )}

        {step === 1 && (
          <Section1Presentacion
            checks={presentacionChecks}
            setChecks={setPresentacionChecks}
            firstName={firstName}
          />
        )}

        {step === 2 && (
          <Section2Descubrimiento
            firstName={firstName}
            objetivo={objetivo} setObjetivo={setObjetivo}
            nivelReal={nivelReal} setNivelReal={setNivelReal}
            dificultades={dificultades} setDificultades={setDificultades}
            dificultadOtra={dificultadOtra} setDificultadOtra={setDificultadOtra}
          />
        )}

        {step === 3 && (
          <Section3MiniClase
            nivelReal={nivelReal}
            checks={miniClaseChecks} setChecks={setMiniClaseChecks}
            obs={miniClaseObs} setObs={setMiniClaseObs}
            globalSecs={globalSecs}
          />
        )}

        {step === 4 && (
          <Section4Transicion
            q1={cierreQ1} setQ1={setCierreQ1}
            q2={cierreQ2} setQ2={setCierreQ2}
            q3={cierreQ3} setQ3={setCierreQ3}
          />
        )}

        {step === 5 && (
          <Section5Packs />
        )}

        {step === 6 && (
          <Section6Cierre
            ctx={classCtx}
            scriptId={scriptId}
            firstName={firstName}
            objetivo={objetivo}
            chosenPack={chosenPack} setChosenPack={setChosenPack}
            chosenPackOtro={chosenPackOtro} setChosenPackOtro={setChosenPackOtro}
            paymentType={paymentType} setPaymentType={setPaymentType}
            wasSent={wasSent} setWasSent={setWasSent}
            paymentConfirmed={paymentConfirmed} setPaymentConfirmed={setPaymentConfirmed}
            onConverted={() => setOutcome("converted")}
            onAttended={() => setOutcome("attended")}
          />
        )}

        {step === 7 && (
          <Section7Resultado
            resultado={resultado} setResultado={setResultado}
            resultadoOtro={resultadoOtro} setResultadoOtro={setResultadoOtro}
            resultadoRazones={resultadoRazones} setResultadoRazones={setResultadoRazones}
            razonOtra={razonOtra} setRazonOtra={setRazonOtra}
            teacherNotes={teacherNotes} setTeacherNotes={setTeacherNotes}
            paymentConfirmed={paymentConfirmed}
          />
        )}

        {error && <ErrorBar message={error} />}

        {/* Navigation */}
        <div className="mt-6 flex items-center justify-between">
          {step > 0 ? (
            <button type="button" onClick={goBack} disabled={pending}
              className="text-sm rounded-full border border-slate-300 dark:border-slate-600 px-4 py-2 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50">
              ← Atrás
            </button>
          ) : (
            <a href="/admin/clasedeprueba"
              className="text-sm rounded-full border border-slate-300 dark:border-slate-600 px-4 py-2 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800">
              ← Salir
            </a>
          )}

          {step === 0 && (
            <button type="button" disabled={pending} onClick={() => {
              setTimerRunning(true);
              advance(1, {});
            }}
              className="text-sm font-semibold rounded-full bg-emerald-500 text-white px-6 py-2 hover:bg-emerald-600 disabled:opacity-50">
              {pending ? "Guardando..." : "Comenzar clase →"}
            </button>
          )}

          {step === 1 && (
            <button type="button" disabled={pending} onClick={() => {
              advance(2, { presentacion_checks: presentacionChecks });
            }}
              className="text-sm font-semibold rounded-full bg-emerald-500 text-white px-6 py-2 hover:bg-emerald-600 disabled:opacity-50">
              {pending ? "Guardando..." : "Siguiente →"}
            </button>
          )}

          {step === 2 && (
            <button type="button" disabled={pending} onClick={() => {
              if (!objetivo.trim()) { setError("El objetivo es obligatorio."); return; }
              if (!nivelReal) { setError("Selecciona el nivel real."); return; }
              const difs = dificultadOtra.trim()
                ? (dificultades ? dificultades + "||" + dificultadOtra.trim() : dificultadOtra.trim())
                : dificultades;
              advance(3, { objetivo, nivel_objetivo: nivelReal, motivacion: difs });
            }}
              className="text-sm font-semibold rounded-full bg-emerald-500 text-white px-6 py-2 hover:bg-emerald-600 disabled:opacity-50">
              {pending ? "Guardando..." : "Siguiente →"}
            </button>
          )}

          {step === 3 && (
            <button type="button" disabled={pending} onClick={() => {
              advance(4, { mini_clase_checks: miniClaseChecks, mini_clase_obs: miniClaseObs });
            }}
              className="text-sm font-semibold rounded-full bg-emerald-500 text-white px-6 py-2 hover:bg-emerald-600 disabled:opacity-50">
              {pending ? "Guardando..." : "Siguiente →"}
            </button>
          )}

          {step === 4 && (
            <button type="button" disabled={pending} onClick={() => {
              if (!cierreQ1 || !cierreQ2 || !cierreQ3) { setError("Responde las 3 preguntas."); return; }
              const allPositive = isPositive(cierreQ1) && isPositive(cierreQ2) && isPositive(cierreQ3);
              advance(allPositive ? 5 : 7, { cierre_q1: cierreQ1, cierre_q2: cierreQ2, cierre_q3: cierreQ3 });
            }}
              className="text-sm font-semibold rounded-full bg-emerald-500 text-white px-6 py-2 hover:bg-emerald-600 disabled:opacity-50">
              {pending ? "Guardando..." : "Siguiente →"}
            </button>
          )}

          {step === 5 && (
            <button type="button" disabled={pending} onClick={() => {
              advance(6, {});
            }}
              className="text-sm font-semibold rounded-full bg-emerald-500 text-white px-6 py-2 hover:bg-emerald-600 disabled:opacity-50">
              {pending ? "Guardando..." : "Siguiente →"}
            </button>
          )}

          {step === 6 && !wasSent && (
            <button type="button" disabled={pending} onClick={() => {
              advance(7, {
                chosen_pack: chosenPack || null,
                payment_type: paymentType || null,
                payment_confirmed: paymentConfirmed,
              });
            }}
              className="text-sm font-semibold rounded-full bg-slate-400 text-white px-6 py-2 hover:bg-slate-500 disabled:opacity-50">
              {pending ? "Guardando..." : "Saltar al resultado →"}
            </button>
          )}

          {step === 6 && wasSent && paymentConfirmed === false && (
            <button type="button" disabled={pending} onClick={() => {
              advance(7, {
                chosen_pack: chosenPack || null,
                payment_type: paymentType || null,
                payment_confirmed: false,
              });
            }}
              className="text-sm font-semibold rounded-full bg-emerald-500 text-white px-6 py-2 hover:bg-emerald-600 disabled:opacity-50">
              {pending ? "Guardando..." : "Continuar al resultado →"}
            </button>
          )}

          {step === 7 && (
            <button type="button" disabled={pending} onClick={() => {
              if (!resultado && paymentConfirmed !== true) { setError("Selecciona el resultado."); return; }
              const finalRes = resultadoOtro.trim() ? resultadoOtro.trim() : resultado;
              const finalRaz = razonOtra.trim()
                ? (resultadoRazones ? resultadoRazones + "||" + razonOtra.trim() : razonOtra.trim())
                : resultadoRazones;
              // Append floating notes to teacher_notes
              const allNotes = [teacherNotes, floatingNotesRef.current].filter(Boolean).join("\n\n---\nNotas flotantes:\n");
              startTransition(async () => {
                try {
                  const finalOutcome = paymentConfirmed === true ? "converted" : "attended";
                  await saveStepAction(scriptId, {
                    resultado: finalRes,
                    resultado_razones: finalRaz || null,
                    teacher_notes: allNotes || null,
                    final_outcome: finalOutcome,
                    completed_at: new Date().toISOString(),
                    final_marked_at: new Date().toISOString(),
                    current_step: 7,
                  });
                  if (typeof window !== "undefined") {
                    localStorage.removeItem(`cp_notes_${scriptId}`);
                  }
                  setOutcome(finalOutcome);
                } catch (e) {
                  setError(e instanceof Error ? e.message : "Error al guardar.");
                }
              });
            }}
              className="text-sm font-semibold rounded-full bg-emerald-500 text-white px-6 py-2 hover:bg-emerald-600 disabled:opacity-50">
              {pending ? "Guardando..." : "Finalizar y guardar"}
            </button>
          )}
        </div>
      </div>

      <ProgressBar step={step} total={TOTAL_SECTIONS} />

      {/* Floating notes panel */}
      <div className="fixed bottom-4 right-4 z-50">
        {notesOpen ? (
          <div className="w-72 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-lg p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Notas</span>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-slate-400">{notesSaved ? "Guardado" : "..."}</span>
                <button type="button" onClick={() => setNotesOpen(false)}
                  className="text-xs text-slate-400 hover:text-slate-600">✕</button>
              </div>
            </div>
            <textarea
              value={floatingNotes}
              onChange={e => { setFloatingNotes(e.target.value); setNotesSaved(false); }}
              rows={5}
              placeholder="Notas rápidas durante la clase..."
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm p-2 resize-none focus:outline-none focus:ring-1 focus:ring-emerald-400 text-slate-700 dark:text-slate-200"
            />
          </div>
        ) : (
          <button type="button" onClick={() => setNotesOpen(true)}
            className="rounded-full bg-emerald-500 text-white shadow-lg px-4 py-2.5 text-sm font-semibold hover:bg-emerald-600">
            Notas
          </button>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Header
// ─────────────────────────────────────────────────────────────────

function WizardHeader({
  ctx, stepNum, totalSteps, globalSecs, onQuickAbsent, absentPending,
}: {
  ctx: ClassContext; stepNum: number; totalSteps: number;
  globalSecs: number | null;
  onQuickAbsent: () => void; absentPending: boolean;
}) {
  const defaultBucket = normalizeLevelBucket(ctx.lead.germanLevel) ?? "A1";
  const [selectedLevel, setSelectedLevel] = useState<LevelBucket>(defaultBucket);
  const presentationUrl = LEVEL_PRESENTATION_URL[selectedLevel];

  const timerStr = globalSecs !== null
    ? `${String(Math.floor(globalSecs / 60)).padStart(2, "0")}:${String(globalSecs % 60).padStart(2, "0")}`
    : null;

  return (
    <header className="rounded-2xl bg-gradient-to-br from-emerald-500/10 to-amber-500/10 border border-emerald-300/30 px-4 py-3 flex items-start justify-between gap-3 flex-wrap">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[11px] uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
            Clase de prueba · Sección {stepNum} de {totalSteps - 1}
          </span>
          {timerStr && (
            <span className="text-xs font-mono font-bold text-amber-700 dark:text-amber-300 tabular-nums bg-amber-100 dark:bg-amber-500/15 px-2 py-0.5 rounded-full">
              {timerStr}
            </span>
          )}
        </div>
        <div className="mt-0.5 text-base font-bold text-slate-900 dark:text-slate-50">
          {ctx.lead.name ?? "(sin nombre)"} · nivel {ctx.lead.germanLevel ?? "?"} · {ctx.lead.language === "de" ? "alemán" : "español"}
        </div>
        <div className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
          Motivo: {ctx.lead.motivo ?? "—"} · Profe: {ctx.teacherName ?? "—"}
        </div>
      </div>
      <div className="shrink-0 flex items-center gap-1.5 flex-wrap">
        {ctx.lead.whatsapp && (
          <a href={`https://wa.me/${ctx.lead.whatsapp.replace(/[^\d]/g, "")}`}
            target="_blank" rel="noreferrer"
            className="text-xs font-semibold rounded-full border border-emerald-300 bg-emerald-100 px-3 py-1.5 text-emerald-800 hover:bg-emerald-200">
            WhatsApp
          </a>
        )}
        <div className="inline-flex items-center rounded-full border border-indigo-300 bg-indigo-100 dark:bg-indigo-500/15 overflow-hidden">
          <a href={presentationUrl} target="_blank" rel="noreferrer"
            className="text-xs font-semibold px-3 py-1.5 text-indigo-800 dark:text-indigo-200 hover:bg-indigo-200 dark:hover:bg-indigo-500/25">
            Presentación
          </a>
          <select value={selectedLevel} onChange={e => setSelectedLevel(e.target.value as LevelBucket)}
            className="text-xs font-semibold bg-transparent border-l border-indigo-300/60 dark:border-indigo-500/40 px-2 py-1.5 text-indigo-800 dark:text-indigo-200 hover:bg-indigo-200/60 dark:hover:bg-indigo-500/25 focus:outline-none"
            aria-label="Nivel de presentación">
            {(["A0","A1","A2","B1","B2","C1"] as const).map(lvl => (
              <option key={lvl} value={lvl}>{lvl}</option>
            ))}
          </select>
        </div>
        <button type="button" onClick={onQuickAbsent} disabled={absentPending}
          className="text-xs font-semibold rounded-full border border-amber-400 bg-amber-100 dark:bg-amber-500/15 px-3 py-1.5 text-amber-900 dark:text-amber-200 hover:bg-amber-200 dark:hover:bg-amber-500/25 disabled:opacity-50">
          {absentPending ? "Marcando..." : "No asistió"}
        </button>
      </div>
    </header>
  );
}

// ─────────────────────────────────────────────────────────────────
// Sections
// ─────────────────────────────────────────────────────────────────

function Section0Prep({ ctx }: { ctx: ClassContext }) {
  const scheduledDate = new Date(ctx.scheduledAt);
  const dateStr = scheduledDate.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });
  const timeStr = scheduledDate.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });

  return (
    <div>
      <StepTitle emoji="📋" title="Preparación"
        hint="Revisa los datos del lead antes de comenzar. Cuando estés listo, pulsa 'Comenzar clase'." />
      <div className="rounded-xl bg-slate-50 dark:bg-slate-800 p-5 space-y-3">
        <DataRow label="Nombre" value={ctx.lead.name} />
        <DataRow label="Email" value={ctx.lead.email} />
        <DataRow label="WhatsApp" value={ctx.lead.whatsapp} />
        <DataRow label="Fecha/hora" value={`${dateStr}, ${timeStr}`} />
        <DataRow label="Nivel declarado" value={ctx.lead.germanLevel} />
        <DataRow label="Motivo" value={ctx.lead.motivo} />
        <DataRow label="Idioma" value={ctx.lead.language === "de" ? "Alemán" : "Español"} />
        <DataRow label="Profesor" value={ctx.teacherName} />
      </div>
    </div>
  );
}

function Section1Presentacion({
  checks, setChecks, firstName,
}: {
  checks: string; setChecks: (v: string) => void; firstName: string;
}) {
  return (
    <div>
      <StepTitle emoji="👋" title="Presentación (0-2 min)"
        hint="Genera confianza con el lead. Sigue esta guía y marca los checkboxes cuando completes cada punto." />
      <SuggestedPhrase text={`¡Hola ${firstName}! Bienvenido/a a tu clase de prueba. Soy [tu nombre] y seré tu profesor/a hoy. Antes de empezar con la clase, me gustaría conocerte un poco mejor para poder adaptarla a ti.`} />
      <div className="mt-4 space-y-2">
        {PRESENTACION_CHECKS.map(label => (
          <CheckboxItem key={label} label={label}
            checked={checks.includes(label)}
            onChange={on => {
              const set = new Set(checks.split("||").filter(Boolean));
              if (on) set.add(label); else set.delete(label);
              setChecks([...set].join("||"));
            }}
          />
        ))}
      </div>
    </div>
  );
}

function Section2Descubrimiento({
  firstName, objetivo, setObjetivo, nivelReal, setNivelReal,
  dificultades, setDificultades, dificultadOtra, setDificultadOtra,
}: {
  firstName: string;
  objetivo: string; setObjetivo: (v: string) => void;
  nivelReal: string; setNivelReal: (v: string) => void;
  dificultades: string; setDificultades: (v: string) => void;
  dificultadOtra: string; setDificultadOtra: (v: string) => void;
}) {
  return (
    <div>
      <StepTitle emoji="🎯" title="Descubrimiento (2-5 min)"
        hint="3 preguntas clave. Escucha atentamente — estas respuestas personalizan el cierre." />

      <Field label="Pregunta 1: Objetivo" required>
        <SuggestedPhrase text={`${firstName}, antes de empezar quiero conocerte mejor. ¿Cuál es tu objetivo principal con el alemán?`} />
        <textarea value={objetivo} onChange={e => setObjetivo(e.target.value)} rows={2}
          placeholder='Ej: "Quiero mudarme a Alemania para trabajar como enfermera"'
          className="input-text w-full mt-2" />
      </Field>

      <Field label="Pregunta 2: Nivel real" required>
        <SuggestedPhrase text="¿Has estudiado alemán antes? ¿Cuál es tu nivel actual?" />
        <div className="flex flex-wrap gap-2 mt-2">
          {NIVEL_OPTIONS.map(lvl => (
            <button key={lvl} type="button" onClick={() => setNivelReal(lvl)}
              className={`rounded-xl px-4 py-2.5 text-sm font-medium transition border-2 ${
                nivelReal === lvl
                  ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-900 dark:text-emerald-200"
                  : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:border-emerald-300"
              }`}>
              {lvl}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Pregunta 3: Mayor dificultad">
        <SuggestedPhrase text="¿Qué es lo que más te cuesta del alemán?" />
        <ChipSelect options={DIFICULTAD_OPTIONS} value={dificultades} onChange={setDificultades} multi />
        <input type="text" value={dificultadOtra} onChange={e => setDificultadOtra(e.target.value)}
          placeholder="Otra (especificar)"
          className="input-text w-full mt-2" />
      </Field>
    </div>
  );
}

function Section3MiniClase({
  nivelReal, checks, setChecks, obs, setObs, globalSecs,
}: {
  nivelReal: string;
  checks: string; setChecks: (v: string) => void;
  obs: string; setObs: (v: string) => void;
  globalSecs: number;
}) {
  const bucket = normalizeLevelBucket(nivelReal) ?? "A1";
  const mm = String(Math.floor(globalSecs / 60)).padStart(2, "0");
  const ss = String(globalSecs % 60).padStart(2, "0");

  const levelTips: Record<string, string> = {
    A0: "Empieza con saludos básicos, números, presentarse. Usa visual aids.",
    A1: "Verbos regulares, vocabulario cotidiano. Pregúntale cosas simples en alemán.",
    A2: "Conversación guiada, situaciones reales. Prueba un pequeño diálogo.",
    B1: "Debate un tema sencillo. Corrige gramática en contexto.",
    B2: "Discusión sobre un artículo o tema complejo. Vocabulario avanzado.",
    C1: "Debate libre, matices del idioma, expresiones idiomáticas.",
  };

  return (
    <div>
      <StepTitle emoji="📖" title="Mini clase (5-22 min)"
        hint="¡Es hora de enseñar! Adapta el contenido al nivel del lead." />

      <div className="rounded-xl bg-amber-100/60 dark:bg-amber-500/10 border border-amber-300/40 px-4 py-2 flex items-center justify-between mb-4">
        <span className="text-sm text-amber-900 dark:text-amber-200">
          Tiempo de clase — objetivo ~17 min
        </span>
        <span className="text-xl font-mono font-bold text-amber-900 dark:text-amber-200 tabular-nums">
          {mm}:{ss}
        </span>
      </div>

      <div className="rounded-xl bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/30 p-4 mb-4">
        <p className="text-sm font-semibold text-indigo-900 dark:text-indigo-200 mb-1">
          Sugerencia para nivel {bucket}:
        </p>
        <p className="text-sm text-indigo-800 dark:text-indigo-300">
          {levelTips[bucket] ?? levelTips.A1}
        </p>
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-4">
        {(["A0","A1","A2","B1","B2","C1"] as const).map(lvl => (
          <a key={lvl} href={LEVEL_PRESENTATION_URL[lvl]} target="_blank" rel="noopener noreferrer"
            className={`flex items-center justify-center rounded-lg border px-3 py-2 font-semibold text-sm transition-colors ${
              lvl === bucket
                ? "bg-emerald-100 border-emerald-400 text-emerald-800 dark:bg-emerald-900/30 dark:border-emerald-500 dark:text-emerald-300"
                : "bg-white dark:bg-slate-700 border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-600"
            }`}>
            {lvl}
          </a>
        ))}
      </div>

      <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 mt-5 mb-2">Post mini-clase:</p>
      <div className="space-y-2">
        {MINI_CLASE_CHECKS.map(label => (
          <CheckboxItem key={label} label={label}
            checked={checks.includes(label)}
            onChange={on => {
              const set = new Set(checks.split("||").filter(Boolean));
              if (on) set.add(label); else set.delete(label);
              setChecks([...set].join("||"));
            }}
          />
        ))}
      </div>

      <Field label="Observaciones de la clase">
        <textarea value={obs} onChange={e => setObs(e.target.value)} rows={3}
          placeholder="¿Cómo fue la interacción? ¿Qué tan cómodo se sintió el lead? ¿Algo que notar?"
          className="input-text w-full" />
      </Field>
    </div>
  );
}

function Section4Transicion({
  q1, setQ1, q2, setQ2, q3, setQ3,
}: {
  q1: string; setQ1: (v: string) => void;
  q2: string; setQ2: (v: string) => void;
  q3: string; setQ3: (v: string) => void;
}) {
  const showObjectionQ1 = q1 && !isPositive(q1);
  const showObjectionQ2 = q2 && !isPositive(q2);
  const showObjectionQ3 = q3 && !isPositive(q3);

  return (
    <div>
      <StepTitle emoji="🤝" title="Transición al cierre (22-25 min)"
        hint="3 preguntas de cierre. Si alguna es negativa, se muestra una guía para manejar la objeción." />

      <Field label="Pregunta 1" required>
        <SuggestedPhrase text="¿Sentiste que mi método te funcionó? ¿Pudiste seguirme bien y aprender algo concreto en estos minutos?" />
        <RadioGroup options={CIERRE_Q1_OPTIONS} value={q1} onChange={setQ1} />
        {showObjectionQ1 && (
          <ObjectionTip tip="Pregunta qué parte no le convenció. Ofrece adaptar el método: 'En las clases normales puedo ajustar el ritmo 100% a ti. Hoy era una muestra de 15 min — imagina lo que logramos en sesiones completas.'" />
        )}
      </Field>

      <Field label="Pregunta 2" required>
        <SuggestedPhrase text="Pensando en tu objetivo con el alemán, ¿estarías de acuerdo conmigo que con clases así, podrías llegar a tu meta mucho más rápido que aprendiendo solo/a?" />
        <RadioGroup options={CIERRE_Q2_OPTIONS} value={q2} onChange={setQ2} />
        {showObjectionQ2 && (
          <ObjectionTip tip="Recuérdale su objetivo original y valida la preocupación: 'Entiendo la duda. Piensa que con un profesor tienes correcciones en tiempo real y un plan personalizado — eso es lo que marca la diferencia vs. apps o autodidacta.'" />
        )}
      </Field>

      <Field label="Pregunta 3" required>
        <SuggestedPhrase text="Si todo encajara — horario, grupo, inversión — ¿estarías listo/a para empezar esta semana?" />
        <RadioGroup options={CIERRE_Q3_OPTIONS} value={q3} onChange={setQ3} />
        {showObjectionQ3 && (
          <ObjectionTip tip="No presiones. Pregunta: '¿Qué necesitarías resolver para poder tomar la decisión?' — deja que el lead hable. A veces solo necesita que le confirmes la flexibilidad de horarios o de pago." />
        )}
      </Field>

      {q1 && q2 && q3 && (
        <div className={`mt-4 rounded-xl p-4 text-sm font-semibold ${
          isPositive(q1) && isPositive(q2) && isPositive(q3)
            ? "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-800 dark:text-emerald-200 border border-emerald-200 dark:border-emerald-500/30"
            : "bg-amber-50 dark:bg-amber-500/10 text-amber-800 dark:text-amber-200 border border-amber-200 dark:border-amber-500/30"
        }`}>
          {isPositive(q1) && isPositive(q2) && isPositive(q3)
            ? "Las 3 respuestas son positivas — puedes pasar a presentar los packs."
            : "Alguna respuesta es negativa — al pulsar 'Siguiente' irás directamente al resultado final."}
        </div>
      )}
    </div>
  );
}

function Section5Packs() {
  return (
    <div>
      <StepTitle emoji="📦" title="Presentación de packs"
        hint="Abre la página de cursos y presenta las opciones al lead desde ahí." />
      <SuggestedPhrase text="Perfecto. Basándome en lo que vimos hoy y en tu objetivo, déjame mostrarte las opciones que tenemos." />

      <div className="mt-5 rounded-xl border-2 border-emerald-300 dark:border-emerald-500/40 bg-emerald-50 dark:bg-emerald-500/10 p-4">
        <p className="text-sm font-semibold text-emerald-900 dark:text-emerald-100 mb-1">
          Además de las clases en vivo, la academia incluye:
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <a href="https://schule.aprender-aleman.de" target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-3 rounded-xl border border-emerald-200 dark:border-emerald-500/30 bg-white dark:bg-slate-800 p-3 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 transition">
            <span className="text-2xl">📚</span>
            <div>
              <div className="text-sm font-bold text-slate-900 dark:text-slate-100">SCHULE</div>
              <div className="text-xs text-slate-600 dark:text-slate-400">Ejercicios: Gramática · Lectura · Escucha · Habla · Escritura</div>
            </div>
          </a>
          <a href="https://hans.aprender-aleman.de" target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-3 rounded-xl border border-emerald-200 dark:border-emerald-500/30 bg-white dark:bg-slate-800 p-3 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 transition">
            <span className="text-2xl">🤖</span>
            <div>
              <div className="text-sm font-bold text-slate-900 dark:text-slate-100">HANS</div>
              <div className="text-xs text-slate-600 dark:text-slate-400">Profesor con IA por texto y voz</div>
            </div>
          </a>
        </div>
        <p className="mt-3 text-center text-sm font-bold text-emerald-800 dark:text-emerald-200">LAS CLASES QUEDAN GRABADAS</p>
      </div>

      <div className="mt-5 flex justify-center">
        <a href="https://aprender-aleman.de/cursos" target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-6 py-3 text-base transition shadow-md">
          ABRIR PÁGINA DE CURSOS →
        </a>
      </div>
    </div>
  );
}

function Section6Cierre({
  ctx, scriptId, firstName, objetivo,
  chosenPack, setChosenPack, chosenPackOtro, setChosenPackOtro,
  paymentType, setPaymentType,
  wasSent, setWasSent,
  paymentConfirmed, setPaymentConfirmed,
  onConverted, onAttended,
}: {
  ctx: ClassContext; scriptId: string; firstName: string; objetivo: string;
  chosenPack: string; setChosenPack: (v: string) => void;
  chosenPackOtro: string; setChosenPackOtro: (v: string) => void;
  paymentType: PaymentType | ""; setPaymentType: (v: PaymentType) => void;
  wasSent: boolean; setWasSent: (v: boolean) => void;
  paymentConfirmed: boolean | null; setPaymentConfirmed: (v: boolean | null) => void;
  onConverted: () => void; onAttended: () => void;
}) {
  const [sending, startSending] = useTransition();
  const [confirming, startConfirming] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const packOptions = [
    ...TRIAL_PACKS.map(p => ({ id: p.id, label: p.name })),
    { id: "otro", label: "Otro pack (especificar)" },
    { id: "necesita_tiempo", label: "Necesita más tiempo (objeción)" },
  ];

  const selectedPack = TRIAL_PACKS.find(p => p.id === chosenPack);
  const canSendLink = selectedPack && paymentType;

  const handleSendLink = () => {
    if (!selectedPack || !paymentType) return;
    setErr(null);
    startSending(async () => {
      try {
        await completeAttendedAction({
          scriptId,
          leadId: ctx.leadId,
          packId: selectedPack.id as PackId,
          paymentType: paymentType as PaymentType,
          objective: objetivo,
          teacherNotes: "",
        });
        await saveStepAction(scriptId, {
          chosen_pack: selectedPack.id,
          payment_type: paymentType,
        });
        setWasSent(true);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Error al enviar.");
      }
    });
  };

  const handlePaymentConfirmed = () => {
    setErr(null);
    startConfirming(async () => {
      try {
        await saveStepAction(scriptId, {
          payment_confirmed: true,
          final_outcome: "converted",
          completed_at: new Date().toISOString(),
          final_marked_at: new Date().toISOString(),
          resultado: "Pagó",
        });
        onConverted();
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Error al confirmar.");
      }
    });
  };

  if (wasSent && paymentConfirmed === null) {
    return (
      <div>
        <StepTitle emoji="⏳" title="Esperando confirmación del pago"
          hint="El link de pago fue enviado por WhatsApp. Pregúntale al lead si completó el pago." />

        <div className="rounded-xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30 p-4 mb-4 text-center">
          <p className="text-base font-semibold text-emerald-800 dark:text-emerald-200">
            Link enviado. Esperando confirmación del estudiante.
          </p>
        </div>

        <SuggestedPhrase text={`Bien. Te paso el link de pago AHORA mismo por WhatsApp. Mientras lo abres, voy preparando tu inscripción. ¿Tienes el WhatsApp abierto?`} />

        <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button type="button" onClick={handlePaymentConfirmed} disabled={confirming}
            className="text-base font-bold rounded-xl bg-emerald-500 text-white px-5 py-3 hover:bg-emerald-600 disabled:opacity-50">
            {confirming ? "Guardando..." : "PAGO CONFIRMADO"}
          </button>
          <button type="button" onClick={() => setPaymentConfirmed(false)} disabled={confirming}
            className="text-base font-bold rounded-xl border border-amber-300 dark:border-amber-500/40 bg-amber-100 dark:bg-amber-500/15 text-amber-800 dark:text-amber-200 px-5 py-3 hover:bg-amber-200 dark:hover:bg-amber-500/25 disabled:opacity-50">
            PAGO NO CONFIRMADO AÚN
          </button>
        </div>
        {err && <ErrorBar message={err} />}
      </div>
    );
  }

  if (wasSent && paymentConfirmed === false) {
    return (
      <div>
        <StepTitle emoji="📋" title="Pago pendiente"
          hint="El link fue enviado pero el pago no se confirmó en la clase. Continúa al resultado final." />
        <div className="rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 p-4 text-sm text-amber-800 dark:text-amber-200">
          El lead tiene el link de pago. El seguimiento automático se encargará del follow-up.
        </div>
      </div>
    );
  }

  return (
    <div>
      <StepTitle emoji="💳" title="Cierre y envío de link"
        hint="Registra qué pack eligió el lead y envía el link de pago." />

      <Field label="¿Qué pack eligió?" required>
        <SuggestedPhrase text="¿Cuál te encaja mejor para empezar esta semana?" />
        <div className="space-y-2 mt-2">
          {packOptions.map(opt => (
            <button key={opt.id} type="button" onClick={() => setChosenPack(opt.id)}
              className={`w-full text-left rounded-xl px-4 py-3 text-sm font-medium transition border-2 ${
                chosenPack === opt.id
                  ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-900 dark:text-emerald-200"
                  : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:border-emerald-300"
              }`}>
              {opt.label}
            </button>
          ))}
        </div>
        {chosenPack === "otro" && (
          <input type="text" value={chosenPackOtro} onChange={e => setChosenPackOtro(e.target.value)}
            placeholder="Especifica el pack"
            className="input-text w-full mt-2" />
        )}
      </Field>

      {chosenPack && chosenPack !== "necesita_tiempo" && (
        <Field label="¿Modalidad de pago?">
          <SuggestedPhrase text={selectedPack
            ? `Perfecto, ${selectedPack.name}. ¿Te ahorras con pago único o lo prefieres en cuotas?`
            : "¿Pago único o cuotas?"} />
          <div className="grid grid-cols-2 gap-3 mt-2">
            {(["single", "flexible"] as const).map(t => (
              <button key={t} type="button" onClick={() => setPaymentType(t)}
                className={`rounded-xl p-4 border-2 text-center transition ${
                  paymentType === t
                    ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-500/10"
                    : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-emerald-300"
                }`}>
                <div className="font-bold text-slate-900 dark:text-slate-50">
                  {t === "single" ? "Pago único" : "Cuotas mensuales"}
                </div>
                <div className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                  {t === "single" ? "Descuento por anticipado" : "Mensualidades"}
                </div>
              </button>
            ))}
          </div>
        </Field>
      )}

      {canSendLink && (
        <div className="mt-5">
          <button type="button" onClick={handleSendLink} disabled={sending}
            className="w-full text-base font-bold rounded-xl bg-green-600 text-white px-5 py-4 hover:bg-green-700 disabled:opacity-50 shadow-md">
            {sending ? "Enviando..." : "ENVIAR LINK DE PAGO POR WHATSAPP"}
          </button>
        </div>
      )}

      {err && <ErrorBar message={err} />}
    </div>
  );
}

function Section7Resultado({
  resultado, setResultado, resultadoOtro, setResultadoOtro,
  resultadoRazones, setResultadoRazones, razonOtra, setRazonOtra,
  teacherNotes, setTeacherNotes, paymentConfirmed,
}: {
  resultado: string; setResultado: (v: string) => void;
  resultadoOtro: string; setResultadoOtro: (v: string) => void;
  resultadoRazones: string; setResultadoRazones: (v: string) => void;
  razonOtra: string; setRazonOtra: (v: string) => void;
  teacherNotes: string; setTeacherNotes: (v: string) => void;
  paymentConfirmed: boolean | null;
}) {
  const isPaid = paymentConfirmed === true || resultado === "Pagó";
  const showReasons = resultado && resultado !== "Pagó" && !resultado.startsWith("Dijo \"pago mañana\"");

  return (
    <div>
      <StepTitle emoji="🏁" title="Resultado final"
        hint="Registra el resultado de la clase y cualquier observación." />

      {paymentConfirmed === true && (
        <div className="rounded-xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30 p-4 mb-4 text-sm font-semibold text-emerald-800 dark:text-emerald-200">
          El pago fue confirmado en la sección anterior. Solo agrega tus comentarios finales.
        </div>
      )}

      {paymentConfirmed !== true && (
        <Field label="Resultado" required>
          <div className="space-y-2 mt-1">
            {RESULTADO_OPTIONS.map(opt => (
              <button key={opt} type="button" onClick={() => setResultado(opt)}
                className={`w-full text-left rounded-xl px-4 py-3 text-sm font-medium transition border-2 ${
                  resultado === opt
                    ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-900 dark:text-emerald-200"
                    : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:border-emerald-300"
                }`}>
                {opt}
              </button>
            ))}
            <button type="button" onClick={() => setResultado("otro")}
              className={`w-full text-left rounded-xl px-4 py-3 text-sm font-medium transition border-2 ${
                resultado === "otro"
                  ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-900 dark:text-emerald-200"
                  : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:border-emerald-300"
              }`}>
              Otro (especificar)
            </button>
          </div>
          {resultado === "otro" && (
            <input type="text" value={resultadoOtro} onChange={e => setResultadoOtro(e.target.value)}
              placeholder="Especifica el resultado"
              className="input-text w-full mt-2" />
          )}
        </Field>
      )}

      {showReasons && (
        <Field label="Razones específicas de no compra">
          <ChipSelect options={RESULTADO_RAZONES_OPTIONS} value={resultadoRazones} onChange={setResultadoRazones} multi />
          <input type="text" value={razonOtra} onChange={e => setRazonOtra(e.target.value)}
            placeholder="Otra razón (especificar)"
            className="input-text w-full mt-2" />
        </Field>
      )}

      <Field label="Comentarios finales del profesor">
        <textarea value={teacherNotes} onChange={e => setTeacherNotes(e.target.value)} rows={3}
          placeholder="Lo que quieras dejar registrado: actitud del lead, observaciones, seguimiento sugerido..."
          className="input-text w-full" />
      </Field>
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
        {label}{required && <span className="text-rose-500"> *</span>}
      </span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function SuggestedPhrase({ text }: { text: string }) {
  return (
    <div className="rounded-xl bg-sky-50 dark:bg-sky-500/10 border border-sky-200 dark:border-sky-500/30 px-4 py-3 text-sm text-sky-900 dark:text-sky-100 italic leading-relaxed">
      <span className="not-italic font-semibold text-sky-700 dark:text-sky-300 text-xs uppercase tracking-wider block mb-1">
        Di al lead:
      </span>
      &ldquo;{text}&rdquo;
    </div>
  );
}

function ChipSelect({ options, value, onChange, multi }: {
  options: string[]; value: string; onChange: (v: string) => void; multi?: boolean;
}) {
  const selected = multi ? value.split("||").filter(Boolean) : [value];
  const toggle = (opt: string) => {
    if (multi) {
      const set = new Set(selected);
      if (set.has(opt)) set.delete(opt); else set.add(opt);
      onChange([...set].join("||"));
    } else {
      onChange(opt === value ? "" : opt);
    }
  };
  return (
    <div className="flex flex-wrap gap-2 mt-1">
      {options.map(opt => (
        <button key={opt} type="button" onClick={() => toggle(opt)}
          className={`rounded-xl px-4 py-2.5 text-sm font-medium transition border-2 ${
            selected.includes(opt)
              ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-900 dark:text-emerald-200"
              : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:border-emerald-300"
          }`}>
          {opt}
        </button>
      ))}
    </div>
  );
}

function RadioGroup({ options, value, onChange }: {
  options: string[]; value: string; onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-2 mt-2">
      {options.map(opt => (
        <button key={opt} type="button" onClick={() => onChange(opt)}
          className={`w-full text-left rounded-xl px-4 py-3 text-sm font-medium transition border-2 ${
            value === opt
              ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-900 dark:text-emerald-200"
              : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:border-emerald-300"
          }`}>
          {opt}
        </button>
      ))}
    </div>
  );
}

function CheckboxItem({ label, checked, onChange }: {
  label: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-3 cursor-pointer hover:border-emerald-300 transition">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-slate-300 text-emerald-500 focus:ring-emerald-400" />
      <span className="text-sm text-slate-700 dark:text-slate-200">{label}</span>
    </label>
  );
}

function DataRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 w-28 shrink-0">{label}</span>
      <span className="text-sm text-slate-800 dark:text-slate-200">{value || "—"}</span>
    </div>
  );
}

function ObjectionTip({ tip }: { tip: string }) {
  return (
    <div className="mt-2 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
      <span className="font-semibold text-xs uppercase tracking-wider block mb-1">Guía de objeción:</span>
      {tip}
    </div>
  );
}

function ErrorBar({ message }: { message: string }) {
  return (
    <div className="mt-4 rounded-lg bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 px-3 py-2 text-sm text-rose-700 dark:text-rose-300">
      {message}
    </div>
  );
}

function ProgressBar({ step, total }: { step: number; total: number }) {
  return (
    <div className="mt-4 flex items-center justify-center gap-1.5">
      {Array.from({ length: total }, (_, i) => (
        <span key={i}
          className={`h-1.5 rounded-full transition-all ${
            i === step ? "w-8 bg-emerald-500"
              : i < step ? "w-2 bg-emerald-300"
              : "w-2 bg-slate-300 dark:bg-slate-700"
          }`} />
      ))}
    </div>
  );
}

function FinalDone({ title, body }: { title: string; body: string }) {
  return (
    <div className="text-center py-6">
      <h2 className="mt-3 text-xl font-bold text-slate-900 dark:text-slate-50">{title}</h2>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-400 max-w-md mx-auto">{body}</p>
      <button type="button" onClick={() => window.close()}
        className="mt-5 text-sm rounded-full border border-slate-300 dark:border-slate-600 px-4 py-2 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800">
        Cerrar pestaña
      </button>
    </div>
  );
}

export {};
