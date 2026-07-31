"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MobileDayStrip } from "@/components/agendar/MobileDayStrip";
import { TimeList, type SlotItem } from "@/components/agendar/TimeList";
import { BrandLogo } from "@/components/BrandLogo";
import { IllustrationPanel, type StepKey } from "@/components/diagnostico/IllustrationPanel";
import { COUNTRY_CODES, resolvePhone } from "@/lib/phone";
import { captureAttributionFromUrl, readAttribution } from "@/lib/ads-attribution";
import { trackFunnel } from "@/lib/track-funnel";

/**
 * Wizard /meta-ads-paid — 5 pasos + form + Stripe redirect.
 *
 * Layout: split-screen estilo Preply (IllustrationPanel a la izquierda,
 * contenido a la derecha; en mobile se apila como banda superior +
 * contenido debajo). Igual que /agendar/cuando y /diagnostico.
 */

// 5 pasos (Gelfis 2026-07-28: eliminado el paso "dolor"):
//   1. Goal · 2. Level · 3. Deadline · 4. Calendar · 5. Form
type Step = 1 | 2 | 3 | 4 | 5;

type GoalId    = "job" | "ausbildung" | "citizenship" | "daily_life" | "moving";
type LevelId   = "zero" | "basic" | "intermediate" | "advanced" | "unknown";
type DeadlineId= "concrete" | "6m" | "year" | "no_rush";

const GOALS: Array<{ id: GoalId; label: string; emoji: string }> = [
  { id: "job",         emoji: "💼",  label: "Conseguir un mejor trabajo" },
  { id: "ausbildung",  emoji: "🎓",  label: "Mi Ausbildung o estudios" },
  { id: "citizenship", emoji: "🇩🇪", label: "La nacionalidad y trámites oficiales" },
  { id: "daily_life",  emoji: "🗣️",  label: "Mi día a día (médico, Amt, vecinos)" },
  { id: "moving",      emoji: "✈️",  label: "Voy a mudarme a Alemania o Suiza" },
];
const LEVELS: Array<{ id: LevelId; label: string; emoji?: string }> = [
  { id: "zero",         label: "Cero, no hablo nada" },
  { id: "basic",        label: "Básico, me presento y poco más (A1-A2)" },
  { id: "intermediate", label: "Intermedio, me defiendo pero me trabo (B1)" },
  { id: "advanced",     label: "Avanzado, quiero perfeccionar (B2+)" },
  { id: "unknown",      emoji: "🤷", label: "No lo sé — que me lo diga el profesor" },
];
const DEADLINES: Array<{ id: DeadlineId; label: string; emoji?: string }> = [
  { id: "concrete", emoji: "🔥", label: "Ya — tengo una fecha concreta (examen, entrevista, trámite)" },
  { id: "6m",       label: "En los próximos 6 meses" },
  { id: "year",     label: "Este año" },
  { id: "no_rush",  label: "Sin prisa, pero en serio" },
];

function levelToDbEnum(l: LevelId): "A0" | "A1" | "A2" | "B1" | "B2" | "C1" | "C2" | null {
  switch (l) {
    case "zero":         return "A0";
    case "basic":        return "A2";
    case "intermediate": return "B1";
    case "advanced":     return "B2";
    case "unknown":      return null;
  }
}

// Mapa step → ilustración del panel izquierdo.
function stepToIllustration(step: Step): StepKey {
  switch (step) {
    case 1: return "motivo";
    case 2: return "nivel";
    case 3: return "datos";
    case 4: return "calendario";
    case 5: return "formulario";
  }
}

export function PaidFunnelWizard() {
  const [step, setStep] = useState<Step>(1);
  const [goal, setGoal] = useState<GoalId | null>(null);
  const [level, setLevel] = useState<LevelId | null>(null);
  const [deadline, setDeadline] = useState<DeadlineId | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<SlotItem | null>(null);

  useEffect(() => {
    captureAttributionFromUrl();
    trackFunnel("landing_view", { landingIntent: "meta-ads-paid" });
  }, []);

  const advance = (target: Step) => setStep(target);

  return (
    <div className="min-h-[100dvh] flex flex-col bg-white">
      <Header step={step} totalSteps={5} />

      <IllustrationPanel step={stepToIllustration(step)}>
        <main className="flex-1 px-5 md:px-8 lg:px-10 py-6 md:py-10 mx-auto max-w-xl w-full">
          {step === 1 && (
            <QuestionStep
              title="¿Para qué necesitas el alemán?"
              options={GOALS}
              value={goal}
              onSelect={(id) => { setGoal(id); trackFunnel("field_typed", { landingIntent: "meta-ads-paid", answer: `goal:${id}` }); advance(2); }}
            />
          )}
          {step === 2 && (
            <QuestionStep
              title="¿Cuál es tu nivel actual?"
              options={LEVELS}
              value={level}
              onSelect={(id) => { setLevel(id); trackFunnel("field_typed", { landingIntent: "meta-ads-paid", answer: `level:${id}` }); advance(3); }}
            />
          )}
          {step === 3 && (
            <QuestionStep
              title="¿Para cuándo lo necesitas?"
              options={DEADLINES}
              value={deadline}
              onSelect={(id) => { setDeadline(id); trackFunnel("field_typed", { landingIntent: "meta-ads-paid", answer: `deadline:${id}` }); advance(4); }}
            />
          )}
          {step === 4 && (
            <CalendarStep
              onPick={(s) => { setSelectedSlot(s); trackFunnel("slot_picked", { landingIntent: "meta-ads-paid", answer: s.startIso }); advance(5); }}
            />
          )}
          {step === 5 && goal && level && deadline && selectedSlot && (
            <FormStep
              goal={goal}
              level={level}
              deadline={deadline}
              slot={selectedSlot}
            />
          )}

          {step > 1 && step < 5 && (
            <div className="mt-8 text-center">
              <button
                type="button"
                onClick={() => setStep((step - 1) as Step)}
                className="text-[13px] text-slate-500 hover:text-slate-900 underline underline-offset-4"
              >
                ← Volver al paso anterior
              </button>
            </div>
          )}
        </main>
      </IllustrationPanel>
    </div>
  );
}

// ────────────────────── Header con progress ──────────────────────
function Header({ step, totalSteps }: { step: Step; totalSteps: number }) {
  const pct = Math.round(((step - 1) / totalSteps) * 100);
  return (
    <header
      className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-slate-100"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <div className="flex items-center justify-between h-14 md:h-16 px-4 max-w-6xl mx-auto w-full">
        <BrandLogo size="md" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 tabular-nums">
          Paso {step} de {totalSteps}
        </span>
      </div>
      <div className="h-1 bg-slate-100">
        <div className="h-full bg-emerald-600 transition-[width] duration-300" style={{ width: `${pct}%` }} />
      </div>
    </header>
  );
}

type Option<T extends string> = { id: T; label: string; emoji?: string };

function QuestionStep<T extends string>({
  title, options, value, onSelect,
}: {
  title:   string;
  options: ReadonlyArray<Option<T>>;
  value:   T | null;
  onSelect:(id: T) => void;
}) {
  return (
    <div>
      <h1 className="text-[22px] sm:text-[26px] md:text-[30px] font-extrabold tracking-tight text-slate-900 leading-tight mb-5">
        {title}
      </h1>
      <div className="space-y-2.5">
        {options.map(o => {
          const selected = value === o.id;
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => onSelect(o.id)}
              className={[
                "w-full text-left rounded-2xl border-2 px-4 py-3.5 md:py-4",
                "flex items-start gap-3 transition active:scale-[0.99]",
                selected
                  ? "border-emerald-500 bg-emerald-50 text-emerald-900 shadow-lg shadow-emerald-500/15"
                  : "border-slate-200 bg-white text-slate-800 hover:border-slate-300 hover:bg-slate-50",
              ].join(" ")}
              aria-pressed={selected}
            >
              {o.emoji && <span className="text-[22px] leading-none shrink-0" aria-hidden>{o.emoji}</span>}
              <span className="text-[15px] md:text-[16px] font-medium leading-snug">{o.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ────────────────────── Calendar step ──────────────────────
function CalendarStep({ onPick }: { onPick: (s: SlotItem) => void }) {
  const [slots, setSlots] = useState<SlotItem[] | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/public/trial-slots", { cache: "no-store" })
      .then(r => r.json())
      .then(d => { if (!cancelled) setSlots(d.slots ?? []); })
      .catch(() => { if (!cancelled) setLoadErr("No pudimos cargar los horarios. Recarga la página."); });
    return () => { cancelled = true; };
  }, []);

  const displayTz = useMemo(() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Berlin"; }
    catch { return "Europe/Berlin"; }
  }, []);

  const slotsByDay = useMemo(() => {
    const m = new Map<string, SlotItem[]>();
    for (const s of slots ?? []) {
      const key = new Intl.DateTimeFormat("en-CA", { timeZone: displayTz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(s.startIso));
      const list = m.get(key) ?? [];
      list.push(s);
      m.set(key, list);
    }
    return m;
  }, [slots, displayTz]);

  const daysWithSlots = useMemo(() => new Set(slotsByDay.keys()), [slotsByDay]);

  useEffect(() => {
    if (!slots || slots.length === 0 || selectedDay) return;
    const first = new Intl.DateTimeFormat("en-CA", { timeZone: displayTz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(slots[0].startIso));
    setSelectedDay(first);
  }, [slots, selectedDay, displayTz]);

  const todaysSlots = selectedDay ? (slotsByDay.get(selectedDay) ?? []) : [];

  if (loadErr) return <p className="text-red-600 text-sm">{loadErr}</p>;
  if (!slots) return <p className="text-slate-500 text-sm">Cargando horarios…</p>;

  return (
    <div>
      <h1 className="text-[22px] sm:text-[26px] md:text-[30px] font-extrabold tracking-tight text-slate-900 leading-tight mb-4">
        ¿Cuándo te viene mejor tu clase?
      </h1>
      <p className="text-[13px] text-slate-500 mb-4">
        Todos los horarios en tu zona ({displayTz.replace(/_/g, " ")}). Toca un día → elige la hora.
      </p>

      <MobileDayStrip
        daysWithSlots={daysWithSlots}
        selectedDay={selectedDay}
        onSelect={setSelectedDay}
        lightMode
        displayTimezone={displayTz}
      />

      <div className="mt-4">
        <TimeList
          slots={todaysSlots}
          selectedIso={null}
          selectedTeacherId={null}
          onSelect={onPick}
          lightMode
          leadTimezone={displayTz}
        />
      </div>
    </div>
  );
}

// ────────────────────── Form step ──────────────────────
function FormStep({
  goal, level, deadline, slot,
}: {
  goal:     GoalId;
  level:    LevelId;
  deadline: DeadlineId;
  slot:     SlotItem;
}) {
  const [name, setName]   = useState("");
  const [email, setEmail] = useState("");
  const [countryCode, setCountryCode] = useState("+49");
  const [phoneLocal, setPhoneLocal]   = useState("");
  const [submitting, setSubmitting]   = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submittedRef = useRef(false);

  const phoneInfo = useMemo(
    () => resolvePhone(countryCode, phoneLocal),
    [countryCode, phoneLocal],
  );

  const canSubmit = name.trim().length >= 2
                 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
                 && phoneInfo.valid;

  const slotDate = new Date(slot.startIso);
  const slotStr  = slotDate.toLocaleString("es-ES", {
    timeZone: "Europe/Berlin",
    weekday: "long", day: "numeric", month: "long",
    hour: "2-digit", minute: "2-digit",
  });

  const submit = async () => {
    if (!canSubmit || submitting || submittedRef.current) return;
    submittedRef.current = true;
    setSubmitting(true);
    setError(null);
    trackFunnel("submit_attempt", { landingIntent: "meta-ads-paid" });

    const attribution = readAttribution() as Record<string, string | null | undefined>;

    try {
      const res = await fetch("/api/public/book-trial-metaads-paid", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim().toLowerCase(),
          whatsapp_e164: phoneInfo.e164,
          german_level: levelToDbEnum(level),
          slot_iso: slot.startIso,
          teacher_id: slot.teacherId,
          qualification: { goal, level, deadline },
          gclid:        attribution.gclid ?? null,
          gbraid:       attribution.gbraid ?? null,
          wbraid:       attribution.wbraid ?? null,
          fbclid:       attribution.fbclid ?? null,
          utm_source:   attribution.utm_source ?? null,
          utm_medium:   attribution.utm_medium ?? null,
          utm_campaign: attribution.utm_campaign ?? null,
          utm_term:     attribution.utm_term ?? null,
          utm_content:  attribution.utm_content ?? null,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? `HTTP ${res.status}${json.detail ? ` — ${json.detail}` : ""}`);
        setSubmitting(false);
        submittedRef.current = false;
        return;
      }
      trackFunnel("submit_ok", { landingIntent: "meta-ads-paid" });
      if (json.stripeUrl) {
        window.location.href = json.stripeUrl;
      } else if (json.confirmacionUrl) {
        window.location.href = json.confirmacionUrl;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red");
      setSubmitting(false);
      submittedRef.current = false;
    }
  };

  return (
    <div>
      <h1 className="text-[22px] sm:text-[26px] md:text-[30px] font-extrabold tracking-tight text-slate-900 leading-tight mb-2">
        Confirma tu reserva
      </h1>
      <p className="text-[13.5px] text-slate-600 mb-5 capitalize">
        {slotStr} <span className="text-slate-400 lowercase">(Berlín)</span>
      </p>

      {/* Form real — permite al navegador reconocer los campos y ofrecer
          autofill (Chrome/Safari/Firefox usan el atributo autoComplete
          + name + type para saber qué datos meter). submit se maneja
          via onSubmit para que Enter funcione en cualquier input. */}
      <form
        onSubmit={(e) => { e.preventDefault(); submit(); }}
        autoComplete="on"
        className="space-y-4"
      >
        <div>
          <label htmlFor="pf-name" className="block text-[12px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
            Tu nombre
          </label>
          <input
            id="pf-name"
            name="name"
            type="text"
            autoComplete="given-name"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="María García"
            className="w-full h-12 rounded-2xl border border-slate-300 px-4 text-[15px] text-slate-900 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
          />
        </div>

        <div>
          <label htmlFor="pf-email" className="block text-[12px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
            Email
          </label>
          <input
            id="pf-email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="tu@email.com"
            className="w-full h-12 rounded-2xl border border-slate-300 px-4 text-[15px] text-slate-900 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
          />
        </div>

        <div>
          <label htmlFor="pf-phone" className="block text-[12px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
            WhatsApp
          </label>
          <div className="flex gap-2">
            <select
              id="pf-cc"
              name="tel-country-code"
              autoComplete="tel-country-code"
              value={countryCode}
              onChange={e => setCountryCode(e.target.value)}
              className="h-12 rounded-2xl border border-slate-300 px-3 text-[15px] text-slate-900 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 bg-white"
            >
              {COUNTRY_CODES.map(c => (
                <option key={c.code + c.label} value={c.code}>
                  {c.flag} {c.code}
                </option>
              ))}
            </select>
            <input
              id="pf-phone"
              name="tel"
              type="tel"
              inputMode="tel"
              autoComplete="tel-national"
              value={phoneLocal}
              onChange={e => setPhoneLocal(e.target.value)}
              placeholder="612 34 56 78"
              className="flex-1 h-12 rounded-2xl border border-slate-300 px-4 text-[15px] text-slate-900 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
            />
          </div>
          {phoneLocal && !phoneInfo.valid && (
            <p className="mt-1 text-[11.5px] text-red-600">Número no válido para el país seleccionado.</p>
          )}
        </div>

        <button
          type="submit"
          disabled={!canSubmit || submitting}
          className={[
            "w-full h-14 rounded-2xl font-bold text-[16px] transition",
            canSubmit && !submitting
              ? "bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg shadow-emerald-600/30 active:scale-[0.98]"
              : "bg-slate-200 text-slate-400 cursor-not-allowed",
          ].join(" ")}
        >
          {submitting ? "Reservando…" : "Continuar"}
        </button>

        {error && (
          <p className="text-[12.5px] text-red-600 leading-snug">
            {error}
          </p>
        )}

        <p className="text-[11.5px] text-center text-slate-500 leading-snug">
          Tu plaza queda agendada al continuar. Los 10€ se descuentan íntegros de tu programa si continúas.
        </p>
      </form>
    </div>
  );
}
