"use client";

import { useEffect, useRef, useState } from "react";

/**
 * «¿Cómo funciona?» (Gelfis 2026-11-05): al pulsar el enlace del menú el
 * alumno elige entre ver el vídeo tutorial o seguir el tour paso a paso por
 * la pantalla real. Las dos opciones se pueden repetir las veces que quiera:
 * al acabar el vídeo se ofrece verlo otra vez o seguir el paso a paso.
 */
const T = {
  es: {
    title: "¿Cómo funciona la plataforma?",
    sub: "Elige cómo quieres verlo. Puedes repetir las dos opciones cuando quieras.",
    video: "Ver el vídeo",
    videoHint: (m: string) => `${m} · voz y subtítulos en español`,
    tour: "Paso a paso",
    tourHint: "Te señalamos cada parte en tu propia pantalla.",
    close: "Cerrar",
    back: "← Volver",
    again: "Ver otra vez",
    thenTour: "Seguir el paso a paso",
    videoTitle: "Vídeo: cómo funciona la plataforma",
  },
  de: {
    title: "Wie funktioniert die Plattform?",
    sub: "Wähle, wie du es sehen möchtest. Beide Optionen kannst du jederzeit wiederholen.",
    video: "Video ansehen",
    videoHint: (m: string) => `${m} · Stimme und Untertitel auf Spanisch`,
    tour: "Schritt für Schritt",
    tourHint: "Wir zeigen dir jeden Bereich direkt auf deinem Bildschirm.",
    close: "Schließen",
    back: "← Zurück",
    again: "Noch einmal ansehen",
    thenTour: "Weiter mit Schritt für Schritt",
    videoTitle: "Video: So funktioniert die Plattform",
  },
};

export type HelpVideo = { src: string; poster?: string; minutes: string };

export function HelpChooser({ lang, video, onTour, onClose }: {
  lang: "es" | "de";
  video: HelpVideo | null;
  onTour: () => void;
  onClose: () => void;
}) {
  const t = T[lang];
  const [mode, setMode] = useState<"chooser" | "video">("chooser");
  const [ended, setEnded] = useState(false);
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const replay = () => { setEnded(false); const v = ref.current; if (v) { v.currentTime = 0; void v.play(); } };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={t.title}>
      <button type="button" onClick={onClose} className="absolute inset-0 bg-slate-900/70" aria-label={t.close} />

      {mode === "chooser" || !video ? (
        <div className="relative w-full max-w-2xl rounded-3xl bg-white dark:bg-slate-900 shadow-2xl border border-slate-200 dark:border-slate-700 p-6 sm:p-8">
          <button type="button" onClick={onClose} className="absolute right-4 top-4 text-xl leading-none text-slate-400 hover:text-slate-700 dark:hover:text-slate-200" aria-label={t.close}>×</button>
          <h2 className="text-2xl font-extrabold text-slate-900 dark:text-slate-50">{t.title}</h2>
          <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-300">{t.sub}</p>

          <div className={`mt-6 grid gap-4 ${video ? "sm:grid-cols-2" : ""}`}>
            {video && (
              <button type="button" onClick={() => { setEnded(false); setMode("video"); }}
                      className="group rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 p-5 text-left hover:border-brand-400 hover:bg-brand-50/60 dark:hover:bg-brand-500/10 transition">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-500 text-white text-xl shadow">▶</div>
                <div className="mt-3 text-lg font-bold text-slate-900 dark:text-slate-50">{t.video}</div>
                <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">{t.videoHint(video.minutes)}</div>
              </button>
            )}
            <button type="button" onClick={onTour}
                    className="group rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 p-5 text-left hover:border-brand-400 hover:bg-brand-50/60 dark:hover:bg-brand-500/10 transition">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-600 text-white text-xl shadow">☆</div>
              <div className="mt-3 text-lg font-bold text-slate-900 dark:text-slate-50">{t.tour}</div>
              <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">{t.tourHint}</div>
            </button>
          </div>
        </div>
      ) : (
        <div className="relative w-full max-w-5xl rounded-3xl bg-slate-950 shadow-2xl border border-slate-800 p-3 sm:p-4">
          <div className="flex items-center justify-between gap-3 px-1 pb-3">
            <button type="button" onClick={() => setMode("chooser")} className="text-sm text-slate-300 hover:text-white">{t.back}</button>
            <span className="hidden sm:block text-sm font-semibold text-slate-200">{t.videoTitle}</span>
            <button type="button" onClick={onClose} className="text-xl leading-none text-slate-400 hover:text-white" aria-label={t.close}>×</button>
          </div>
          <div className="relative overflow-hidden rounded-2xl bg-black aspect-video">
            <video ref={ref} src={video.src} poster={video.poster} controls autoPlay playsInline preload="metadata"
                   className="h-full w-full" onEnded={() => setEnded(true)} onPlay={() => setEnded(false)} />
            {ended && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-950/80 p-6 text-center">
                <div className="text-lg font-bold text-white">{t.title}</div>
                <div className="flex flex-wrap justify-center gap-3">
                  <button type="button" onClick={replay} className="rounded-xl bg-white/10 hover:bg-white/20 px-5 py-2.5 text-sm font-semibold text-white">{t.again}</button>
                  <button type="button" onClick={onTour} className="rounded-xl bg-brand-500 hover:bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white">{t.thenTour} →</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
