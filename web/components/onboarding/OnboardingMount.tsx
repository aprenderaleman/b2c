"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { GuidedTour } from "./GuidedTour";
import { HelpChooser, type HelpVideo } from "./HelpChooser";
import type { TourStep } from "@/lib/onboarding";

/**
 * Monta el tour cuando toca (primera vez) o cuando se pide con ?tour=1.
 * Con ?ayuda=1 («¿Cómo funciona?» del menú, Gelfis 2026-11-05) abre primero
 * el selector vídeo / paso a paso; sin vídeo configurado va directo al tour.
 * Espera un instante a que la página pinte para medir bien las anclas.
 */
function Inner({ showTour, steps, lang, video }: { showTour: boolean; steps: TourStep[]; lang: "es" | "de"; video: HelpVideo | null }) {
  const sp = useSearchParams();
  const router = useRouter();
  const forcedTour = sp.get("tour") === "1";
  const help = sp.get("ayuda") === "1";
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<"chooser" | "tour">(help && video ? "chooser" : "tour");
  useEffect(() => { const t = setTimeout(() => setReady(true), 400); return () => clearTimeout(t); }, []);
  useEffect(() => { setMode(help && video ? "chooser" : "tour"); }, [help, video]);

  const close = () => { router.replace(window.location.pathname); };
  if (!ready || !(showTour || forcedTour || help)) return null;

  if (mode === "chooser") {
    return <HelpChooser lang={lang} video={video} onTour={() => setMode("tour")} onClose={close} />;
  }
  return (
    <GuidedTour
      steps={steps}
      lang={lang}
      onFinish={() => { if (forcedTour || help) close(); router.refresh(); }}
    />
  );
}

export function OnboardingMount(props: { showTour: boolean; steps: TourStep[]; lang: "es" | "de"; video?: HelpVideo | null }) {
  return <Suspense fallback={null}><Inner {...props} video={props.video ?? null} /></Suspense>;
}
