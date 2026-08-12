"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useLocalParticipant } from "@livekit/components-react";
import { Track, type LocalVideoTrack } from "livekit-client";

/**
 * Selector de fondo virtual para la cámara local. Usa
 * `@livekit/track-processors` (MediaPipe Selfie Segmentation en un
 * Web Worker) — sin cómputo server-side, pero requiere WebGL2 + Wasm
 * SIMD en el cliente.
 *
 * Modos:
 *   "off"    → cámara normal
 *   "blur"   → fondo difuminado
 *   "azul" | "calido" | "verde" → fondos de marca Aprender-Aleman.de
 *
 * Los modos de marca solo aparecen si `brandEnabled` (rollout Gelfis:
 * primero admin/superadmin, luego profes).
 *
 * `initialMode` permite pre-seleccionar el fondo desde el lobby
 * (AulaPreJoin) — se aplica automáticamente en cuanto la cámara
 * publica su track.
 *
 * El processor se importa dinámicamente para que los ~2MB de wasm no
 * engorden el bundle del aula para quien nunca lo usa.
 */

export type BgMode = "off" | "blur" | "azul" | "calido" | "verde";

export const BRAND_IMAGES: Record<Exclude<BgMode, "off" | "blur">, string> = {
  azul:   "/fondo-livekit.png",
  calido: "/fondo-livekit-calido.png",
  verde:  "/fondo-livekit-verde.png",
};

export const BG_LABELS: Record<BgMode, string> = {
  off:    "Sin fondo",
  blur:   "Difuminado",
  azul:   "Marca · Azul",
  calido: "Marca · Cálido",
  verde:  "Marca · Verde",
};

const isBrand = (m: BgMode): m is Exclude<BgMode, "off" | "blur"> =>
  m !== "off" && m !== "blur";

type State = "idle" | "working" | "unsupported";

export function VirtualBackgroundButton({
  canCamera,
  brandEnabled = false,
  initialMode = "off",
}: {
  canCamera: boolean;
  brandEnabled?: boolean;
  initialMode?: BgMode;
}) {
  const { localParticipant } = useLocalParticipant();
  const [mode, setMode] = useState<BgMode>("off");
  const [state, setState] = useState<State>("idle");
  const [menuOpen, setMenuOpen] = useState(false);
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const initialApplied = useRef(false);

  // Si el usuario apaga la cámara externamente, reset — reaplicar tras
  // reencenderla intentaría montar el processor en un track muerto.
  useEffect(() => {
    if (!localParticipant.isCameraEnabled && mode !== "off") {
      setMode("off");
    }
  }, [localParticipant.isCameraEnabled, mode]);

  // Cerrar el menú al clicar fuera.
  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);

  const applyMode = (target: BgMode) => {
    setMenuOpen(false);
    if (state === "working" || target === mode) return;
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

        setState("working");

        if (target === "off") {
          await cameraTrack.stopProcessor();
          setMode("off");
          setState("idle");
          return;
        }

        const { BackgroundBlur, VirtualBackground } = await import("@livekit/track-processors");
        // setProcessor sobre un track con processor previo lo sustituye,
        // pero algunos navegadores fallan — paramos primero por robustez.
        if (mode !== "off") {
          await cameraTrack.stopProcessor().catch(() => {});
        }
        const processor = target === "blur"
          ? BackgroundBlur(10 /* radius */)
          : VirtualBackground(BRAND_IMAGES[target as Exclude<BgMode, "off" | "blur">]);
        await cameraTrack.setProcessor(processor);
        setMode(target);
        setState("idle");
      } catch (e) {
        const msg = e instanceof Error ? e.message : "unknown";
        // Safari viejo / Firefox sin WASM SIMD lanzan en el import.
        if (/wasm|webgl|simd|backgroundblur|virtualbackground/i.test(msg)) {
          setState("unsupported");
        } else {
          setError(msg);
          setMode("off");
          setState("idle");
        }
      }
    });
  };

  // Auto-aplicar la elección hecha en el lobby en cuanto el track de
  // cámara exista. Se reintenta con un poll corto porque LiveKitRoom
  // publica la cámara de forma asíncrona tras conectar.
  useEffect(() => {
    if (initialApplied.current || initialMode === "off" || !canCamera) return;
    let tries = 0;
    const id = setInterval(() => {
      tries++;
      const track = localParticipant.getTrackPublication(Track.Source.Camera)?.track;
      if (track) {
        clearInterval(id);
        initialApplied.current = true;
        applyMode(initialMode);
      } else if (tries > 20) {
        clearInterval(id);   // cámara nunca llegó — rendirse en silencio
      }
    }, 500);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMode, canCamera, localParticipant]);

  if (!canCamera) return null;

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

  const working = state === "working";
  const label = working ? "Aplicando…" : mode === "off" ? "Fondo virtual" : BG_LABELS[mode];

  // Sin la opción de marca, el botón se comporta como el toggle
  // original (off ↔ blur) sin menú.
  const onButtonClick = () => {
    if (working) return;
    if (!brandEnabled) {
      applyMode(mode === "blur" ? "off" : "blur");
    } else {
      setMenuOpen(o => !o);
    }
  };

  const modes: BgMode[] = brandEnabled
    ? ["off", "blur", "azul", "calido", "verde"]
    : ["off", "blur"];

  return (
    <div ref={menuRef} className="relative inline-flex flex-col items-center gap-0.5">
      {/* Con un fondo de marca activo, des-espejamos la self-view local
          para que el texto "Aprender-Aleman.de" del fondo se lea bien
          también para uno mismo (los demás siempre lo ven correcto).
          Override del rotateY(180deg) de @livekit/components-styles. */}
      {isBrand(mode) && (
        <style>{`
          [data-lk-facing-mode=user] .lk-participant-media-video[data-lk-local-participant=true][data-lk-source=camera] {
            transform: none !important;
          }
        `}</style>
      )}
      <button
        type="button"
        onClick={onButtonClick}
        disabled={working}
        className={`h-9 inline-flex items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition
                    ${mode !== "off"
                      ? "bg-warm text-warm-foreground shadow-md shadow-warm/20"
                      : "bg-white/[0.06] text-white hover:bg-white/[0.12]"}
                    ${working ? "opacity-60 cursor-wait" : ""}`}
        title="Fondo virtual"
      >
        <BlurIcon />
        {label}
      </button>

      {menuOpen && (
        <div className="absolute bottom-11 z-50 min-w-[190px] rounded-xl bg-slate-900 border border-white/10 shadow-xl p-1.5 space-y-0.5">
          {modes.map(m => (
            <MenuItem key={m} active={mode === m} onClick={() => applyMode(m)}>
              {BG_LABELS[m]}
            </MenuItem>
          ))}
        </div>
      )}

      {error && (
        <span className="text-[10px] text-red-300 max-w-[140px] truncate" title={error}>
          {error}
        </span>
      )}
    </div>
  );
}

function MenuItem({ active, onClick, children }: {
  active: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left rounded-lg px-3 py-1.5 text-xs transition
                  ${active ? "bg-warm/20 text-warm font-semibold" : "text-white/85 hover:bg-white/[0.08]"}`}
    >
      {children}
    </button>
  );
}

function BlurIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3c-3 4-6 6.5-6 10a6 6 0 0 0 12 0c0-3.5-3-6-6-10z" />
    </svg>
  );
}
