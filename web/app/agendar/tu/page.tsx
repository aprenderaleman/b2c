"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { StepFrame } from "@/components/agendar/FunnelShell";
import { useBookingState } from "@/lib/booking-state";

/**
 * Step 2 — name + email. Two big inputs, one CTA.
 *
 * If the visitor lands here without a slot picked, we bounce them back
 * to step 1 — there's nothing to confirm without a slot, and a
 * mistakenly-typed URL shouldn't crash the funnel.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function StepTu() {
  const router = useRouter();
  const { state, update, hydrated } = useBookingState();

  useEffect(() => {
    if (!hydrated) return;
    if (!state.slot_iso || !state.teacher_id) {
      router.replace("/agendar/cuando");
    }
  }, [hydrated, state.slot_iso, state.teacher_id, router]);

  const nameOk  = state.name.trim().length >= 2;
  const emailOk = EMAIL_RE.test(state.email.trim());
  const canContinue = nameOk && emailOk;

  return (
    <StepFrame
      title="¿Cómo te llamas?"
      subtitle="Te enviamos la confirmación al correo. Sin spam."
      onContinue={() => router.push("/agendar/nivel")}
      canContinue={canContinue}
    >
      <div className="space-y-3">
        <label className="block">
          <span className="text-[11px] font-semibold text-white/55 uppercase tracking-wider">
            Nombre
          </span>
          <input
            type="text"
            value={state.name}
            onChange={(e) => update({ name: e.target.value })}
            placeholder="Tu nombre"
            autoFocus
            autoComplete="given-name"
            className="mt-1 w-full h-14 px-4 rounded-2xl bg-white/[0.08] text-white text-base
                       placeholder:text-white/30 outline-none
                       border border-white/10 focus:border-warm focus:bg-white/[0.10]
                       transition-colors"
          />
        </label>

        <label className="block">
          <span className="text-[11px] font-semibold text-white/55 uppercase tracking-wider">
            Email
          </span>
          <input
            type="email"
            inputMode="email"
            autoComplete="email"
            value={state.email}
            onChange={(e) => update({ email: e.target.value })}
            placeholder="tu@email.com"
            className="mt-1 w-full h-14 px-4 rounded-2xl bg-white/[0.08] text-white text-base
                       placeholder:text-white/30 outline-none
                       border border-white/10 focus:border-warm focus:bg-white/[0.10]
                       transition-colors"
          />
          {state.email.length > 0 && !emailOk && (
            <span className="block mt-1.5 text-xs text-red-300">
              Revisa el formato del correo.
            </span>
          )}
        </label>
      </div>
    </StepFrame>
  );
}
