"use client";

import { useEffect, useState, useTransition } from "react";
import { useLocalParticipant } from "@livekit/components-react";
import { Track, type LocalVideoTrack } from "livekit-client";

/**
 * Toggle button that applies a real-time background blur to the local
 * camera track. Uses LiveKit's `@livekit/track-processors` package
 * which runs MediaPipe Selfie Segmentation in a Web Worker — no extra
 * server-side compute, but does need WebGL2 + Wasm SIMD on the client.
 *
 * State machine:
 *   "off"        → blur not applied
 *   "applying"   → user just clicked, processor mounting on the track
 *   "blurred"    → segmentation pipeline running
 *   "removing"   → user clicked again, tearing down processor
 *   "unsupported" → device can't run the segmenter (older Safari, very old GPU)
 *
 * The processor is created lazily (dynamic import) so the wasm/onnx
 * payload (~2 MB) doesn't bloat the main /aula bundle for visitors
 * who never click the button.
 */

type State = "off" | "applying" | "blurred" | "removing" | "unsupported";

export function VirtualBackgroundButton({ canCamera }: { canCamera: boolean }) {
  const { localParticipant } = useLocalParticipant();
  const [state, setState] = useState<State>("off");
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // If the user toggles their camera off externally, our state needs
  // to reset so reapplying after re-enabling the camera doesn't try
  // to attach a processor to a stale track.
  useEffect(() => {
    if (!localParticipant.isCameraEnabled && state === "blurred") {
      setState("off");
    }
  }, [localParticipant.isCameraEnabled, state]);

  const isWorking = state === "applying" || state === "removing";

  if (state === "unsupported") {
    return (
      <button
        type="button"
        disabled
        className="h-9 inline-flex items-center gap-1.5 rounded-full bg-white/[0.04] px-3 text-xs font-medium text-white/40 cursor-not-allowed"
        title="Tu navegador no soporta fondo virtual (necesita WebGL2 + WASM SIMD)"
      >
        <BlurIcon />
        No disponible
      </button>
    );
  }

  const onClick = () => {
    if (isWorking) return;
    setError(null);
    startTransition(async () => {
      try {
        const cameraTrack = localParticipant.getTrackPublication(Track.Source.Camera)?.track as
          | LocalVideoTrack
          | undefined;
        if (!cameraTrack) {
          setError("Activa la cámara primero.");
          return;
        }

        if (state === "blurred") {
          setState("removing");
          await cameraTrack.stopProcessor();
          setState("off");
          return;
        }

        setState("applying");
        // Dynamic import — keeps the ~2MB segmentation wasm out of the
        // main aula bundle until the user actually wants blur.
        const { BackgroundBlur } = await import("@livekit/track-processors");
        const processor = BackgroundBlur(10 /* radius */);
        await cameraTrack.setProcessor(processor);
        setState("blurred");
      } catch (e) {
        const msg = e instanceof Error ? e.message : "unknown";
        // Older Safari / Firefox without WASM SIMD throw on import.
        if (/wasm|webgl|simd|backgroundblur/i.test(msg)) {
          setState("unsupported");
        } else {
          setError(msg);
          setState("off");
        }
      }
    });
  };

  if (!canCamera) return null;   // device has no camera; hide the button

  return (
    <div className="inline-flex flex-col items-center gap-0.5">
      <button
        type="button"
        onClick={onClick}
        disabled={isWorking}
        className={`h-9 inline-flex items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition
                    ${state === "blurred"
                      ? "bg-warm text-warm-foreground shadow-md shadow-warm/20"
                      : "bg-white/[0.06] text-white hover:bg-white/[0.12]"}
                    ${isWorking ? "opacity-60 cursor-wait" : ""}`}
        title={state === "blurred" ? "Quitar fondo virtual" : "Difuminar el fondo"}
      >
        <BlurIcon />
        {state === "applying" ? "Aplicando…" :
         state === "removing" ? "Quitando…" :
         state === "blurred"  ? "Fondo difuminado" :
                                "Fondo virtual"}
      </button>
      {error && (
        <span className="text-[10px] text-red-300 max-w-[140px] truncate" title={error}>
          {error}
        </span>
      )}
    </div>
  );
}

function BlurIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3c-3 4-6 6.5-6 10a6 6 0 0 0 12 0c0-3.5-3-6-6-10z" />
    </svg>
  );
}
