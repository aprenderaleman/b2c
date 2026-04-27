"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { StepFrame } from "@/components/agendar/FunnelShell";
import { useBookingState, type GermanLevel } from "@/lib/booking-state";

/**
 * Step 3 — German level self-assessment. Tap to pick + auto-advance.
 * Four cards, big tap targets, icon + headline + sublabel.
 */
const LEVELS: { id: GermanLevel; emoji: string; title: string; sub: string }[] = [
  { id: "A0",    emoji: "🌱", title: "No sé nada todavía", sub: "Empezamos desde cero contigo" },
  { id: "A1-A2", emoji: "📘", title: "A1 – A2",            sub: "Lo básico: presentarme, frases cortas" },
  { id: "B1",    emoji: "📗", title: "B1",                 sub: "Conversación cotidiana" },
  { id: "B2+",   emoji: "📕", title: "B2 o superior",      sub: "Avanzado, fluido" },
];

export default function StepNivel() {
  const router = useRouter();
  const { state, update, hydrated } = useBookingState();

  useEffect(() => {
    if (!hydrated) return;
    if (!state.slot_iso) {
      router.replace("/agendar/cuando");
      return;
    }
    if (!state.name || !state.email) {
      router.replace("/agendar/tu");
    }
  }, [hydrated, state.slot_iso, state.name, state.email, router]);

  const onPick = (level: GermanLevel) => {
    update({ german_level: level });
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      try { navigator.vibrate?.(8); } catch { /* iOS no-op */ }
    }
    router.push("/agendar/objetivo");
  };

  return (
    <StepFrame
      title="¿Cuánto alemán sabes ya?"
      subtitle="Para que el profe prepare la clase a tu medida."
    >
      <div className="grid gap-2.5">
        {LEVELS.map(l => {
          const selected = state.german_level === l.id;
          return (
            <button
              key={l.id}
              type="button"
              onClick={() => onPick(l.id)}
              className={[
                "w-full text-left rounded-2xl px-4 py-3.5 flex items-center gap-3",
                "transition active:scale-[0.99]",
                selected
                  ? "bg-warm text-warm-foreground shadow-lg shadow-warm/20"
                  : "bg-white/[0.06] text-white hover:bg-white/[0.10]",
              ].join(" ")}
              aria-pressed={selected}
            >
              <span className="text-2xl shrink-0" aria-hidden>{l.emoji}</span>
              <span className="flex-1 min-w-0">
                <span className="block font-semibold text-[15px] leading-tight">
                  {l.title}
                </span>
                <span className={`block text-[13px] mt-0.5 ${
                  selected ? "text-warm-foreground/80" : "text-white/55"
                }`}>
                  {l.sub}
                </span>
              </span>
              <span className={`text-xl ${selected ? "opacity-100" : "opacity-0"}`} aria-hidden>
                ✓
              </span>
            </button>
          );
        })}
      </div>
    </StepFrame>
  );
}
