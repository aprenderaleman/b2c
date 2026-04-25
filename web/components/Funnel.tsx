"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";

import { Header } from "./Header";
import { ProgressBar } from "./ProgressBar";
import { WhatsAppFloat } from "./WhatsAppFloat";
import { useLang } from "@/lib/lang-context";
import { interpolate } from "@/lib/i18n";
import { COUNTRY_CODES, normalizePhone } from "@/lib/phone";

type GermanLevel = "A0" | "A1-A2" | "B1" | "B2+";
type Goal =
  | "work" | "visa" | "studies" | "exam" | "travel" | "already_in_dach";

type FormState = {
  german_level: GermanLevel | null;
  name: string;
  goal: Goal | null;
  email: string;
  country_code: string;
  phone_local: string;        // empty if user skipped
  gdpr_accepted: boolean;
  // Selected slot (set in step 1 — slot picker comes first in Plan A)
  slot_iso: string | null;
  teacher_id: string | null;
  teacher_name: string | null;
};

type SlotItem = { startIso: string; teacherId: string; teacherName: string };

const TOTAL_STEPS = 4;

const slideVariants = {
  enter:  (dir: number) => ({ x: dir > 0 ? 48 : -48, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit:   (dir: number) => ({ x: dir > 0 ? -48 : 48, opacity: 0 }),
};

/**
 * `embedded=true` removes the inner Header + WhatsAppFloat + page-level
 * paddings so the funnel can drop straight into the homepage hero.
 *
 * `onStepChange` lets the parent react when the lead advances. The
 * homepage uses this to hide the hero/FAQ once the slot is locked in.
 */
export function Funnel({
  embedded = false,
  onStepChange,
}: {
  embedded?: boolean;
  onStepChange?: (step: number) => void;
} = {}) {
  const { lang, t } = useLang();

  const [step, setStep] = useState(1);

  // Notify the parent whenever the step changes (incl. on back).
  useEffect(() => { onStepChange?.(step); }, [step, onStepChange]);
  const [dir, setDir] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [form, setForm] = useState<FormState>({
    german_level: null,
    name: "",
    goal: null,
    email: "",
    country_code: "+49",
    phone_local: "",
    gdpr_accepted: true,           // implicit consent — funnel copy explains the email/WhatsApp use
    slot_iso: null,
    teacher_id: null,
    teacher_name: null,
  });

  // Plan A — slot first (sunk cost), data after.
  // 1. Slot picker         → emotional commitment
  // 2. Name + Email         → minimum viable contact
  // 3. Level                → quick qualify
  // 4. Goal + WhatsApp      → final qualify (WhatsApp REQUIRED)
  //
  // WhatsApp is required so the teacher can confirm the trial and
  // share class material. The copy in step 4 makes clear we only
  // contact the lead for educational purposes.
  const canContinue = useMemo(() => {
    switch (step) {
      case 1: return form.slot_iso !== null && form.teacher_id !== null;
      case 2: return form.name.trim().length >= 2
               && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim());
      case 3: return form.german_level !== null;
      case 4: {
        if (form.goal === null) return false;
        const phoneDigits = form.phone_local.replace(/\D/g, "");
        if (phoneDigits.length < 6) return false;
        const normalized = normalizePhone(
          `${form.country_code} ${form.phone_local}`,
          form.country_code.replace("+", ""),
        );
        return Boolean(normalized);
      }
      default: return false;
    }
  }, [step, form]);

  const goNext = () => {
    if (!canContinue) return;
    if (step < TOTAL_STEPS) {
      setDir(1);
      setStep(step + 1);
    } else {
      void submit();
    }
  };
  const goBack = () => {
    if (step > 1) {
      setDir(-1);
      setStep(step - 1);
    }
  };

  async function submit() {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const phoneDigits = form.phone_local.replace(/\D/g, "");
      const whatsapp_e164 = phoneDigits.length >= 6
        ? normalizePhone(`${form.country_code} ${form.phone_local}`, form.country_code.replace("+", ""))
        : null;

      const res = await fetch("/api/public/book-trial", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          name:           form.name.trim(),
          email:          form.email.trim().toLowerCase(),
          whatsapp_e164,
          whatsapp_raw:   phoneDigits.length >= 6 ? `${form.country_code} ${form.phone_local}` : null,
          german_level:   form.german_level,
          goal:           form.goal,
          language:       lang,
          slot_iso:       form.slot_iso,
          teacher_id:     form.teacher_id,
        }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.status === 409 && data.error === "already_registered") {
        setSubmitError("Ya estás registrado. Inicia sesión y agenda desde tu panel.");
        setSubmitting(false);
        return;
      }
      if (res.status === 409 && data.error === "slot_taken") {
        setSubmitError("Ese horario acaba de reservarse. Elige otro de la lista.");
        setForm({ ...form, slot_iso: null, teacher_id: null, teacher_name: null });
        setSubmitting(false);
        // Force the slot picker to refresh.
        return;
      }
      if (!res.ok || !data.classId || !data.token) {
        throw new Error(data.message || data.error || t.funnel.error);
      }

      // Hand-off to the standalone confirmation page (verifies the
      // token server-side, then renders the SCHULE CTA).
      const params = new URLSearchParams({ c: data.classId, t: data.token });
      window.location.href = `/confirmacion?${params.toString()}`;
      return;
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : t.funnel.error);
      setSubmitting(false);
    }
  }

  // When embedded, render just the form (no Header, no WhatsAppFloat,
  // no min-h-screen) so it can sit inside an existing layout.
  const Wrapper = embedded ? "div" : "main";
  const wrapperClass = embedded
    ? "w-full"
    : "mx-auto max-w-2xl px-4 sm:px-6 pt-8 pb-24";

  return (
    <>
      {!embedded && <Header />}
      <Wrapper className={wrapperClass}>
        <div className="flex items-center gap-4 mb-6">
          <div className="flex-1">
            <ProgressBar step={step} total={TOTAL_STEPS} />
          </div>
          <span className="text-sm text-muted-foreground font-medium whitespace-nowrap">
            {interpolate(t.funnel.progress, { n: step, total: TOTAL_STEPS })}
          </span>
        </div>

        <div className="relative min-h-[420px]">
          <AnimatePresence mode="wait" custom={dir}>
            <motion.div
              key={step}
              custom={dir}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.3, ease: "easeOut" }}
            >
              {step === 1 && (
                <StepSlot
                  form={form}
                  setForm={setForm}
                  refreshTrigger={submitError === "Ese horario acaba de reservarse. Elige otro de la lista." ? 1 : 0}
                />
              )}
              {step === 2 && <StepNameEmail form={form} setForm={setForm} />}
              {step === 3 && <StepLevel form={form} setForm={setForm} />}
              {step === 4 && <StepGoalWhatsApp form={form} setForm={setForm} />}
            </motion.div>
          </AnimatePresence>
        </div>

        {submitError && (
          <p className="mt-4 text-sm text-red-600" role="alert">{submitError}</p>
        )}

        <div className="mt-8 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={goBack}
            disabled={step === 1 || submitting}
            className="btn-secondary"
          >
            ← {t.funnel.back}
          </button>
          <button
            type="button"
            onClick={goNext}
            disabled={!canContinue || submitting}
            className="btn-primary"
          >
            {submitting
              ? t.funnel.sending
              : step === TOTAL_STEPS
                ? "Confirmar reserva"
                : t.funnel.next}
          </button>
        </div>
      </Wrapper>
      {!embedded && <WhatsAppFloat />}
    </>
  );
}

type StepProps = { form: FormState; setForm: (f: FormState) => void };

// ─────────────────────────────────────────────────────────
// STEP 3 — Level
// ─────────────────────────────────────────────────────────
function StepLevel({ form, setForm }: StepProps) {
  const { t } = useLang();
  const opts: GermanLevel[] = ["A0", "A1-A2", "B1", "B2+"];
  return (
    <div className="space-y-4">
      <h2 className="text-2xl sm:text-3xl font-bold text-foreground">{t.step1.title}</h2>
      <div className="grid gap-3">
        {opts.map((lvl) => (
          <button
            key={lvl}
            type="button"
            onClick={() => setForm({ ...form, german_level: lvl })}
            className={`option-card ${form.german_level === lvl ? "option-card--selected" : ""}`}
          >
            <span className="font-medium">{t.step1.options[lvl]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// STEP 2 — Name + Email (combined)
// ─────────────────────────────────────────────────────────
function StepNameEmail({ form, setForm }: StepProps) {
  return (
    <div className="space-y-4">
      <h2 className="text-2xl sm:text-3xl font-bold text-foreground">
        Tus datos para confirmar
      </h2>
      <p className="text-muted-foreground text-sm">
        Te enviamos la confirmación al correo. Sin spam.
      </p>

      <div className="space-y-3">
        <label className="block">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Nombre</span>
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Tu nombre"
            className="input-text text-lg mt-1"
            autoFocus
          />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Email</span>
          <input
            type="email"
            inputMode="email"
            autoComplete="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            placeholder="tu@email.com"
            className="input-text text-lg mt-1"
          />
        </label>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// STEP 4 — Goal + WhatsApp (REQUIRED — the teacher confirms +
//                            shares class material via WhatsApp)
// ─────────────────────────────────────────────────────────
function StepGoalWhatsApp({ form, setForm }: StepProps) {
  const { t } = useLang();
  const opts: Goal[] = ["work", "visa", "studies", "exam", "travel", "already_in_dach"];
  const phoneDigits = form.phone_local.replace(/\D/g, "");
  const showPhoneError = form.phone_local.length > 0 && phoneDigits.length < 6;

  return (
    <div className="space-y-5">
      <h2 className="text-2xl sm:text-3xl font-bold text-foreground">
        Una última cosa
      </h2>
      <p className="text-muted-foreground text-sm">
        Para que tu profesor pueda confirmar la clase y enviarte el material.
      </p>

      <div>
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 block">
          ¿Para qué necesitas el alemán?
        </span>
        <div className="grid gap-2">
          {opts.map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => setForm({ ...form, goal: g })}
              className={`option-card ${form.goal === g ? "option-card--selected" : ""}`}
            >
              <span className="font-medium">{t.step3.options[g]}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="pt-4 border-t border-border">
        <label className="block">
          <span className="text-xs font-semibold text-foreground uppercase tracking-wider mb-2 block">
            Tu número de WhatsApp
          </span>
          <div className="flex gap-2">
            <select
              value={form.country_code}
              onChange={(e) => setForm({ ...form, country_code: e.target.value })}
              className="input-text w-32 text-base"
              aria-label="Código de país"
            >
              {COUNTRY_CODES.map((c) => (
                <option key={c.code} value={c.code}>{c.flag} {c.code}</option>
              ))}
            </select>
            <input
              type="tel"
              inputMode="tel"
              value={form.phone_local}
              onChange={(e) => setForm({ ...form, phone_local: e.target.value })}
              placeholder="123 456 7890"
              className="input-text flex-1"
              autoComplete="tel"
              required
            />
          </div>
        </label>

        {/* Educational-purposes-only disclaimer — clear & prominent */}
        <div className="mt-3 flex items-start gap-2.5 rounded-xl bg-warm/10 border border-warm/30 px-3.5 py-2.5">
          <svg
            width="16" height="16" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            className="text-warm shrink-0 mt-0.5"
            aria-hidden
          >
            <path d="M12 22a10 10 0 1 0-10-10 10 10 0 0 0 10 10z"/>
            <path d="M9 12l2 2 4-4"/>
          </svg>
          <p className="text-xs text-foreground/80 leading-relaxed">
            <strong className="font-semibold text-foreground">Solo te escribiremos con fines educativos:</strong>{" "}
            confirmar tu clase, enviarte material y recordatorios. Sin spam, sin marketing.
          </p>
        </div>

        {showPhoneError && (
          <p className="text-sm text-red-600 mt-2">Escribe un número de WhatsApp válido.</p>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// STEP 1 — Slot picker (Calendly-style: month grid + time column)
// ─────────────────────────────────────────────────────────

const WEEKDAY_LABELS = ["LUN", "MAR", "MIÉ", "JUE", "VIE", "SÁB", "DOM"];
const MONTH_NAMES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

/** "YYYY-MM-DD" key for a given date in Berlin TZ. */
function berlinDateKey(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

function StepSlot({ form, setForm, refreshTrigger }: StepProps & { refreshTrigger: number }) {
  const [slots, setSlots]        = useState<SlotItem[] | null>(null);
  const [loadErr, setLoadErr]    = useState<string | null>(null);
  const [selectedDay, setDay]    = useState<string | null>(null);
  const [monthOffset, setOffset] = useState(0);   // 0 = current month, 1 = next, etc.

  useEffect(() => {
    let cancelled = false;
    setSlots(null);
    setLoadErr(null);
    fetch("/api/public/trial-slots", { cache: "no-store" })
      .then(r => r.json())
      .then(d => { if (!cancelled) setSlots(d.slots ?? []); })
      .catch(() => { if (!cancelled) setLoadErr("No pudimos cargar los horarios. Recarga la página."); });
    return () => { cancelled = true; };
  }, [refreshTrigger]);

  // Bucket slots by Berlin date — drives both the dotted calendar
  // markers and the right-hand time column.
  const slotsByDay = useMemo(() => {
    const map = new Map<string, SlotItem[]>();
    for (const s of slots ?? []) {
      const key = berlinDateKey(new Date(s.startIso));
      const list = map.get(key) ?? [];
      list.push(s);
      map.set(key, list);
    }
    return map;
  }, [slots]);

  // Pre-select the first available day so times appear instantly.
  useEffect(() => {
    if (!slots || slots.length === 0 || selectedDay) return;
    setDay(berlinDateKey(new Date(slots[0].startIso)));
  }, [slots, selectedDay]);

  // 6×7 month grid starting on Monday (Spain/DACH convention).
  const monthGrid = useMemo(() => {
    const today = new Date();
    const baseY = today.getFullYear();
    const baseM = today.getMonth() + monthOffset;
    const firstOfMonth = new Date(baseY, baseM, 1);
    const firstDow = (firstOfMonth.getDay() + 6) % 7;       // Mon=0
    const cells: { date: Date; inMonth: boolean }[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(baseY, baseM, 1 - firstDow + i);
      cells.push({ date: d, inMonth: d.getMonth() === firstOfMonth.getMonth() });
    }
    return {
      title: `${MONTH_NAMES[firstOfMonth.getMonth()]} ${firstOfMonth.getFullYear()}`,
      cells,
    };
  }, [monthOffset]);

  const selectedTimes: SlotItem[] = selectedDay ? (slotsByDay.get(selectedDay) ?? []) : [];

  return (
    <div className="space-y-4">
      <h2 className="text-2xl sm:text-3xl font-extrabold text-foreground tracking-tight uppercase">
        Agendar clase de prueba gratis
      </h2>
      <p className="text-base font-medium text-foreground/80">Elige el día y la hora</p>
      <p className="text-muted-foreground text-sm">
        45 min · clase de prueba gratis · 100% online · zona horaria Berlín
      </p>

      {slots === null && !loadErr && (
        <p className="text-sm text-muted-foreground">Cargando horarios disponibles…</p>
      )}
      {loadErr && <p className="text-sm text-red-600">{loadErr}</p>}
      {slots && slots.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border bg-muted p-6 text-center text-sm text-muted-foreground">
          Estamos completos los próximos 30 días. Escríbenos por WhatsApp y te
          avisamos en cuanto se abran horarios.
        </div>
      )}

      {slots && slots.length > 0 && (
        <div className="grid sm:grid-cols-[1fr_180px] gap-4 mt-2">
          {/* ── Calendar grid */}
          <div className="rounded-2xl border border-border bg-card p-4">
            <header className="flex items-center justify-between mb-3">
              <button
                type="button"
                onClick={() => setOffset(Math.max(0, monthOffset - 1))}
                disabled={monthOffset === 0}
                className="h-8 w-8 inline-flex items-center justify-center rounded-full
                           border border-border text-foreground hover:border-warm
                           disabled:opacity-30 disabled:cursor-not-allowed"
                aria-label="Mes anterior"
              >‹</button>
              <span className="text-sm font-semibold text-foreground capitalize">{monthGrid.title}</span>
              <button
                type="button"
                onClick={() => setOffset(monthOffset + 1)}
                className="h-8 w-8 inline-flex items-center justify-center rounded-full
                           border border-border text-foreground hover:border-warm"
                aria-label="Mes siguiente"
              >›</button>
            </header>

            <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold text-muted-foreground mb-1">
              {WEEKDAY_LABELS.map(l => <span key={l}>{l}</span>)}
            </div>

            <div className="grid grid-cols-7 gap-1">
              {monthGrid.cells.map((c, i) => {
                const key = berlinDateKey(c.date);
                const hasSlots = slotsByDay.has(key);
                const isSelected = selectedDay === key;
                const cellBase = "relative h-10 inline-flex items-center justify-center rounded-full text-sm transition-colors";
                let cls: string;
                if (isSelected)             cls = `${cellBase} bg-warm text-warm-foreground font-semibold cursor-pointer`;
                else if (hasSlots)          cls = `${cellBase} text-warm font-semibold hover:bg-warm/10 cursor-pointer`;
                else if (c.inMonth)         cls = `${cellBase} text-muted-foreground cursor-default`;
                else                        cls = `${cellBase} text-muted-foreground/40 cursor-default`;
                return (
                  <button
                    key={i}
                    type="button"
                    disabled={!hasSlots}
                    onClick={() => hasSlots && setDay(key)}
                    className={cls}
                  >
                    {c.date.getDate()}
                    {hasSlots && !isSelected && (
                      <span className="absolute bottom-1 h-1 w-1 rounded-full bg-warm" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── Times column */}
          <div className="rounded-2xl border border-border bg-card p-3 max-h-[360px] overflow-y-auto">
            {!selectedDay && (
              <p className="text-xs text-muted-foreground p-2">Elige un día con disponibilidad.</p>
            )}
            {selectedDay && selectedTimes.length === 0 && (
              <p className="text-xs text-muted-foreground p-2">Sin horarios para ese día.</p>
            )}
            {selectedDay && selectedTimes.length > 0 && (
              <>
                <p className="text-[11px] font-semibold uppercase text-muted-foreground tracking-wider px-2 pb-2 capitalize">
                  {new Date(selectedTimes[0].startIso).toLocaleDateString("es-ES", {
                    timeZone: "Europe/Berlin", weekday: "long", day: "numeric", month: "short",
                  })}
                </p>
                <div className="flex flex-col gap-1.5">
                  {selectedTimes.map(s => {
                    const time = new Date(s.startIso).toLocaleTimeString("es-ES", {
                      timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit",
                    });
                    const selected = form.slot_iso === s.startIso && form.teacher_id === s.teacherId;
                    return (
                      <button
                        key={`${s.startIso}-${s.teacherId}`}
                        type="button"
                        onClick={() => setForm({
                          ...form,
                          slot_iso:     s.startIso,
                          teacher_id:   s.teacherId,
                          teacher_name: s.teacherName,
                        })}
                        className={`w-full px-3 py-2 rounded-lg border text-sm font-semibold transition-colors text-center
                                    ${selected
                                      ? "border-warm bg-warm text-warm-foreground"
                                      : "border-border bg-background text-foreground hover:border-warm"}`}
                      >
                        {time}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {form.slot_iso && (
        <div className="mt-2 rounded-xl bg-success/10 text-success px-4 py-2 text-sm">
          ✓ {new Date(form.slot_iso).toLocaleString("es-ES", { timeZone: "Europe/Berlin", weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })} (Berlín)
        </div>
      )}
    </div>
  );
}

// Successful bookings hand off to /confirmacion?c=...&t=... — see
// app/confirmacion/page.tsx. No inline success screen anymore.
