"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { StepFrame } from "@/components/agendar/FunnelShell";
import { useBookingState, type Goal } from "@/lib/booking-state";
import { useLang } from "@/lib/lang-context";
import { COUNTRY_CODES, normalizePhone } from "@/lib/phone";

/**
 * Step 4 — goal + WhatsApp, then submit. Identical wire-format to the
 * legacy `<Funnel />` so the `/api/public/book-trial` endpoint, the
 * downstream lead-pipeline agents and the LMS booking flow all keep
 * working untouched.
 */
const GOALS: { id: Goal; emoji: string; label: string }[] = [
  { id: "work",            emoji: "💼", label: "Para mi trabajo" },
  { id: "visa",            emoji: "📄", label: "Para visado / residencia" },
  { id: "studies",         emoji: "🎓", label: "Para estudiar" },
  { id: "exam",            emoji: "✍️", label: "Voy a presentarme a un examen" },
  { id: "travel",          emoji: "✈️", label: "Para viajar" },
  { id: "already_in_dach", emoji: "🏠", label: "Ya vivo en Alemania / Austria / Suiza" },
];

export default function StepObjetivo() {
  const router = useRouter();
  const { lang } = useLang();
  const { state, update, reset, hydrated } = useBookingState();

  const [submitting, setSubmitting] = useState(false);
  const [submitErr,  setSubmitErr]  = useState<string | null>(null);
  // `handedOff` flips true the instant we trigger the navigation to
  // /confirmacion. It freezes the guard useEffect below so the state
  // wipe afterwards can't race the full-page navigation by firing a
  // client-side router.replace("/agendar/cuando") on mobile (where
  // window.location.href is slower than client routing).
  const [handedOff, setHandedOff] = useState(false);

  // Guard: bounce back if earlier steps were skipped. Skipped while
  // submitting or after handing off — otherwise a successful submit's
  // state.reset() would re-trigger this and yank the user back to
  // step 1 before /confirmacion has loaded.
  useEffect(() => {
    if (!hydrated || submitting || handedOff) return;
    if (!state.slot_iso)      { router.replace("/agendar/cuando"); return; }
    if (!state.name || !state.email) { router.replace("/agendar/tu"); return; }
    if (!state.german_level)  { router.replace("/agendar/nivel"); return; }
  }, [hydrated, submitting, handedOff, state, router]);

  const phoneDigits = state.phone_local.replace(/\D/g, "");
  // Live warning: lead picked +34 in the dropdown AND the local digits
  // ALSO start with "34". Most likely they pasted the country code
  // twice. We don't auto-fix in the input (would feel surprising as
  // they type) — we just warn so they catch it before submit. The
  // server-side normalizer will dedupe regardless.
  const ccBare = state.country_code.replace(/\D/g, "");
  const looksDuplicatedCC =
    ccBare.length >= 2 &&
    phoneDigits.startsWith(ccBare) &&
    phoneDigits.length - ccBare.length >= 6;
  const phoneOk = (() => {
    if (phoneDigits.length < 6) return false;
    try {
      return Boolean(normalizePhone(
        `${state.country_code} ${state.phone_local}`,
        state.country_code.replace("+", ""),
      ));
    } catch {
      return false;
    }
  })();

  const canContinue = state.goal !== null && phoneOk;

  async function submit() {
    if (!canContinue || submitting) return;
    setSubmitting(true);
    setSubmitErr(null);
    try {
      const whatsapp_e164 = normalizePhone(
        `${state.country_code} ${state.phone_local}`,
        state.country_code.replace("+", ""),
      );

      const res = await fetch("/api/public/book-trial", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          name:         state.name.trim(),
          email:        state.email.trim().toLowerCase(),
          whatsapp_e164,
          whatsapp_raw: `${state.country_code} ${state.phone_local}`,
          german_level: state.german_level,
          goal:         state.goal,
          language:     lang,
          slot_iso:     state.slot_iso,
          teacher_id:   state.teacher_id,
        }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.status === 409 && data.error === "already_registered") {
        setSubmitErr("Ya estás registrado. Inicia sesión y agenda desde tu panel.");
        setSubmitting(false);
        return;
      }
      if (res.status === 409 && data.error === "slot_taken") {
        // Slot evaporated — wipe it and bounce back to step 1.
        update({ slot_iso: null, teacher_id: null, teacher_name: null });
        setSubmitErr("Ese horario acaba de reservarse. Elige otro.");
        setTimeout(() => router.push("/agendar/cuando"), 900);
        setSubmitting(false);
        return;
      }
      if (!res.ok || !data.classId || !data.token) {
        throw new Error(data.message || data.error || "No se pudo confirmar la reserva.");
      }

      // Success — navigate FIRST, then clear the cached form. The
      // order matters on mobile: setting state empty before the
      // full-page navigation lets a re-render fire the guard
      // useEffect, which would client-route us back to step 1
      // (router.replace beats window.location.href on slower
      // devices). Freeze the guard, kick the navigation, then wipe
      // sessionStorage on the way out.
      setHandedOff(true);
      const params = new URLSearchParams({ c: data.classId, t: data.token });
      window.location.href = `/confirmacion?${params.toString()}`;
      // sessionStorage cleanup happens after the nav has been queued.
      // If the browser cancels for some reason the user can refresh
      // /agendar — they just won't see stale form values.
      reset();
      return;
    } catch (e) {
      setSubmitErr(e instanceof Error ? e.message : "Algo salió mal. Inténtalo de nuevo.");
      setSubmitting(false);
    }
  }

  return (
    <StepFrame
      title="Una última cosa"
      subtitle="Nos sirve para preparar tu clase y confirmártela."
      onContinue={submit}
      canContinue={canContinue}
      ctaLabel="Confirmar mi clase"
      loading={submitting}
    >
      <div className="space-y-6">
        <div>
          <span className="text-[11px] font-semibold text-white/55 uppercase tracking-wider mb-2 block">
            ¿Para qué quieres aprender?
          </span>
          <div className="grid gap-2">
            {GOALS.map(g => {
              const selected = state.goal === g.id;
              return (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => update({ goal: g.id })}
                  className={[
                    "w-full text-left rounded-2xl px-4 h-12 flex items-center gap-3",
                    "transition active:scale-[0.99]",
                    selected
                      ? "bg-warm text-warm-foreground shadow-lg shadow-warm/20"
                      : "bg-white/[0.06] text-white hover:bg-white/[0.10]",
                  ].join(" ")}
                  aria-pressed={selected}
                >
                  <span className="text-lg" aria-hidden>{g.emoji}</span>
                  <span className="flex-1 text-[14px] font-medium">{g.label}</span>
                  <span className={`text-base ${selected ? "opacity-100" : "opacity-0"}`} aria-hidden>✓</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="pt-1">
          <span className="text-[11px] font-semibold text-white/55 uppercase tracking-wider mb-2 block">
            Tu WhatsApp
          </span>
          <div className="flex gap-2">
            <select
              value={state.country_code}
              onChange={(e) => update({ country_code: e.target.value })}
              className="h-14 w-[110px] rounded-2xl bg-white/[0.08] border border-white/10
                         text-white text-base px-2 outline-none focus:border-warm"
              aria-label="Código de país"
            >
              {COUNTRY_CODES.map(c => (
                <option key={c.code} value={c.code} className="text-foreground">
                  {c.flag} {c.code}
                </option>
              ))}
            </select>
            <input
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={state.phone_local}
              onChange={(e) => update({ phone_local: e.target.value })}
              placeholder="123 456 7890"
              className="flex-1 h-14 px-4 rounded-2xl bg-white/[0.08] text-white text-base
                         placeholder:text-white/30 outline-none
                         border border-white/10 focus:border-warm focus:bg-white/[0.10]
                         transition-colors"
              required
            />
          </div>

          <div className="mt-3 flex items-start gap-2.5 rounded-2xl bg-warm/10 border border-warm/30 px-3.5 py-2.5">
            <svg
              width="16" height="16" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
              className="text-warm shrink-0 mt-0.5" aria-hidden
            >
              <path d="M12 22a10 10 0 1 0-10-10 10 10 0 0 0 10 10z"/>
              <path d="M9 12l2 2 4-4"/>
            </svg>
            <p className="text-xs text-white/85 leading-relaxed">
              <strong className="font-semibold text-white">Solo te escribiremos con fines educativos:</strong>{" "}
              confirmar tu clase, enviarte material y recordatorios. Sin spam.
            </p>
          </div>

          {state.phone_local.length > 0 && phoneDigits.length < 6 && (
            <p className="text-xs text-red-300 mt-2">Escribe un número de WhatsApp válido.</p>
          )}
          {looksDuplicatedCC && (
            <p className="text-xs text-amber-300 mt-2">
              Parece que escribiste el prefijo <strong>{state.country_code}</strong> dos veces.
              Pon solo el número (sin el {state.country_code}) — el prefijo ya está seleccionado arriba.
            </p>
          )}
        </div>

        {submitErr && (
          <p className="text-sm text-red-300 -mt-2" role="alert">
            {submitErr}
          </p>
        )}
      </div>
    </StepFrame>
  );
}
