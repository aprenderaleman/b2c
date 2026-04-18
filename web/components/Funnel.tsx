"use client";

import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { Header } from "./Header";
import { ProgressBar } from "./ProgressBar";
import { WhatsAppFloat } from "./WhatsAppFloat";
import { useLang } from "@/lib/lang-context";
import { interpolate } from "@/lib/i18n";
import { COUNTRY_CODES, isValidE164, normalizePhone } from "@/lib/phone";

type GermanLevel = "A0" | "A1-A2" | "B1" | "B2+";
type Goal =
  | "work" | "visa" | "studies" | "exam" | "travel" | "already_in_dach";
type Urgency =
  | "asap" | "under_3_months" | "in_6_months" | "next_year" | "just_looking";

type FormState = {
  german_level: GermanLevel | null;
  name: string;
  goal: Goal | null;
  country_code: string;   // "+49" format
  phone_local: string;    // digits only
  gdpr_accepted: boolean;
  urgency: Urgency | null;
};

const TOTAL_STEPS = 5;

const slideVariants = {
  enter:  (dir: number) => ({ x: dir > 0 ? 48 : -48, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit:   (dir: number) => ({ x: dir > 0 ? -48 : 48, opacity: 0 }),
};

export function Funnel() {
  const router = useRouter();
  const { lang, t } = useLang();

  const [step, setStep] = useState(1);
  const [dir, setDir] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [form, setForm] = useState<FormState>({
    german_level: null,
    name: "",
    goal: null,
    country_code: "+49",
    phone_local: "",
    gdpr_accepted: false,
    urgency: null,
  });

  const canContinue = useMemo(() => {
    switch (step) {
      case 1: return form.german_level !== null;
      case 2: return form.name.trim().length >= 2;
      case 3: return form.goal !== null;
      case 4: return form.phone_local.replace(/\D/g, "").length >= 6 && form.gdpr_accepted;
      case 5: return form.urgency !== null;
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
      const rawPhone = `${form.country_code} ${form.phone_local}`;
      const whatsapp_normalized = normalizePhone(rawPhone, form.country_code.replace("+", ""));

      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          german_level: form.german_level,
          goal: form.goal,
          urgency: form.urgency,
          whatsapp_raw: rawPhone,
          whatsapp_normalized,
          language: lang,
          gdpr_accepted: form.gdpr_accepted,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || t.funnel.error);
      }

      // Persist name for the confirmation page (no PII in URL).
      sessionStorage.setItem("aa_lead_name", form.name.trim());
      router.push("/confirmacion");
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : t.funnel.error);
      setSubmitting(false);
    }
  }

  return (
    <>
      <Header />
      <main className="mx-auto max-w-2xl px-4 sm:px-6 pt-8 pb-24">
        <div className="flex items-center gap-4 mb-6">
          <div className="flex-1">
            <ProgressBar step={step} total={TOTAL_STEPS} />
          </div>
          <span className="text-sm text-slate-500 dark:text-slate-400 font-medium whitespace-nowrap">
            {interpolate(t.funnel.progress, { n: step })}
          </span>
        </div>

        <div className="relative min-h-[380px]">
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
              {step === 1 && <StepLevel form={form} setForm={setForm} />}
              {step === 2 && <StepName form={form} setForm={setForm} />}
              {step === 3 && <StepGoal form={form} setForm={setForm} />}
              {step === 4 && <StepWhatsapp form={form} setForm={setForm} />}
              {step === 5 && <StepUrgency form={form} setForm={setForm} />}
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
                ? t.funnel.finish
                : t.funnel.next}
          </button>
        </div>
      </main>
      <WhatsAppFloat />
    </>
  );
}

// ─────────────────────────────────────────────────────────
// STEP 1 — German level
// ─────────────────────────────────────────────────────────

function StepLevel({ form, setForm }: StepProps) {
  const { t } = useLang();
  const opts: GermanLevel[] = ["A0", "A1-A2", "B1", "B2+"];
  return (
    <div className="space-y-5">
      <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-slate-50">
        {t.step1.title}
      </h2>
      <div className="grid gap-3">
        {opts.map((lvl) => (
          <button
            key={lvl}
            type="button"
            onClick={() => setForm({ ...form, german_level: lvl })}
            className={`option-card ${
              form.german_level === lvl ? "option-card--selected" : ""
            }`}
          >
            <span className="font-medium">{t.step1.options[lvl]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// STEP 2 — Name
// ─────────────────────────────────────────────────────────

function StepName({ form, setForm }: StepProps) {
  const { t } = useLang();
  return (
    <div className="space-y-5">
      <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-slate-50">
        {t.step2.title}
      </h2>
      <input
        type="text"
        value={form.name}
        onChange={(e) => setForm({ ...form, name: e.target.value })}
        placeholder={t.step2.placeholder}
        className="input-text text-lg"
        autoFocus
        maxLength={80}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// STEP 3 — Goal
// ─────────────────────────────────────────────────────────

function StepGoal({ form, setForm }: StepProps) {
  const { t } = useLang();
  const opts: Goal[] = ["work", "visa", "studies", "exam", "travel", "already_in_dach"];
  const firstName = form.name.trim().split(/\s+/)[0] || "";
  return (
    <div className="space-y-5">
      <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-slate-50">
        {interpolate(t.step3.title, { name: firstName })}
      </h2>
      <div className="grid gap-3">
        {opts.map((g) => (
          <button
            key={g}
            type="button"
            onClick={() => setForm({ ...form, goal: g })}
            className={`option-card ${
              form.goal === g ? "option-card--selected" : ""
            }`}
          >
            <span className="font-medium">{t.step3.options[g]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// STEP 4 — WhatsApp
// ─────────────────────────────────────────────────────────

function StepWhatsapp({ form, setForm }: StepProps) {
  const { t } = useLang();
  const phoneDigits = form.phone_local.replace(/\D/g, "");
  const showPhoneError = form.phone_local.length > 0 && phoneDigits.length < 6;

  return (
    <div className="space-y-5">
      <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-slate-50">
        {t.step4.title}
      </h2>
      <p className="text-slate-600 dark:text-slate-300">{t.step4.subtitle}</p>

      <div className="flex gap-2">
        <select
          value={form.country_code}
          onChange={(e) => setForm({ ...form, country_code: e.target.value })}
          className="input-text w-32 text-base"
          aria-label="Country code"
        >
          {COUNTRY_CODES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.flag} {c.code}
            </option>
          ))}
        </select>
        <input
          type="tel"
          inputMode="tel"
          value={form.phone_local}
          onChange={(e) => setForm({ ...form, phone_local: e.target.value })}
          placeholder={t.step4.phonePlaceholder}
          className="input-text flex-1"
          autoComplete="tel"
        />
      </div>
      {showPhoneError && (
        <p className="text-sm text-red-600">{t.step4.errorPhone}</p>
      )}

      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={form.gdpr_accepted}
          onChange={(e) => setForm({ ...form, gdpr_accepted: e.target.checked })}
          className="mt-1 h-5 w-5 rounded border-slate-300 text-brand-500
                     focus:ring-brand-500 cursor-pointer"
        />
        <span className="text-sm text-slate-700 dark:text-slate-200">
          {t.step4.gdprLabel}{" "}
          <Link href="/privacy" target="_blank" className="text-brand-600 hover:underline">
            {t.step4.gdprLink}
          </Link>
        </span>
      </label>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// STEP 5 — Urgency
// ─────────────────────────────────────────────────────────

function StepUrgency({ form, setForm }: StepProps) {
  const { t } = useLang();
  const opts: Urgency[] = [
    "asap", "under_3_months", "in_6_months", "next_year", "just_looking",
  ];
  return (
    <div className="space-y-5">
      <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-slate-50">
        {t.step5.title}
      </h2>
      <div className="grid gap-3">
        {opts.map((u) => (
          <button
            key={u}
            type="button"
            onClick={() => setForm({ ...form, urgency: u })}
            className={`option-card ${
              form.urgency === u ? "option-card--selected" : ""
            }`}
          >
            <span className="font-medium">{t.step5.options[u]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

type StepProps = {
  form: FormState;
  setForm: (f: FormState) => void;
};
