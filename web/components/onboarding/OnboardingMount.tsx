"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { GuidedTour } from "./GuidedTour";
import type { TourStep } from "@/lib/onboarding";

/**
 * Monta el tour cuando toca (primera vez) o cuando se pide con ?tour=1.
 * Espera un instante a que la página pinte para medir bien las anclas.
 */
function Inner({ showTour, steps, lang }: { showTour: boolean; steps: TourStep[]; lang: "es" | "de" }) {
  const sp = useSearchParams();
  const router = useRouter();
  const forced = sp.get("tour") === "1";
  const [ready, setReady] = useState(false);
  useEffect(() => { const t = setTimeout(() => setReady(true), 400); return () => clearTimeout(t); }, []);
  if (!ready || !(showTour || forced)) return null;
  return (
    <GuidedTour
      steps={steps}
      lang={lang}
      onFinish={() => { if (forced) router.replace(window.location.pathname); router.refresh(); }}
    />
  );
}

export function OnboardingMount(props: { showTour: boolean; steps: TourStep[]; lang: "es" | "de" }) {
  return <Suspense fallback={null}><Inner {...props} /></Suspense>;
}
