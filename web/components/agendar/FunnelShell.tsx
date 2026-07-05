"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { IllustrationPanel, type StepKey } from "@/components/diagnostico/IllustrationPanel";
import { BrandLogo } from "@/components/BrandLogo";

/**
 * Permite a una página /agendar/* sobreescribir la ilustración del
 * shell según su estado interno (ej. /cuando muestra "calendario"
 * mientras se elige slot y cambia a "formulario" al rellenar datos).
 * `null` = usar el default basado en la URL.
 */
const IllustrationOverrideCtx = createContext<{
  set: (key: StepKey | null) => void;
}>({ set: () => {} });

export function useSetIllustration(): (key: StepKey | null) => void {
  return useContext(IllustrationOverrideCtx).set;
}

/**
 * Mobile-first app-shell for the booking funnel.
 *
 * Wraps every /agendar/* page con:
 *  - Light mode (estilo Preply, post-2026-05-26) — alineado con el
 *    redesign del funnel diagnóstico.
 *  - Layout split-screen vía IllustrationPanel: imagen izquierda
 *    (desktop) / banda superior (mobile), contenido derecha/abajo.
 *  - Header sticky con back, paso N/4 y cerrar.
 *  - Progress strip naranja.
 */

const STEP_PATHS = ["/agendar/cuando", "/agendar/tu", "/agendar/nivel", "/agendar/objetivo"] as const;
type StepPath = typeof STEP_PATHS[number];

function stepIndexFor(pathname: string): number {
  const idx = (STEP_PATHS as readonly string[]).indexOf(pathname);
  return idx >= 0 ? idx : 0;
}

// Mapeo path → key de ilustración (las del IllustrationPanel).
function illustrationKeyFor(pathname: string): "calendario" | "datos" | "nivel" | "motivo" {
  if (pathname.startsWith("/agendar/tu"))       return "datos";
  if (pathname.startsWith("/agendar/nivel"))    return "nivel";
  if (pathname.startsWith("/agendar/objetivo")) return "motivo";
  return "calendario";
}

export function FunnelShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/agendar/cuando";
  const router   = useRouter();
  const idx      = stepIndexFor(pathname);
  const stepNum  = idx + 1;
  const total    = STEP_PATHS.length;

  // Theme-color cream/rose pastel — alineado con el redesign light
  // mode del funnel principal (commit eeaf9c5).
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.setAttribute("name",    "theme-color");
    meta.setAttribute("content", "#FFF1ED");
    meta.setAttribute("data-funnel-shell", "1");
    document.head.appendChild(meta);
    return () => { meta.remove(); };
  }, []);

  const onBack = () => {
    if (idx > 0) {
      router.push(STEP_PATHS[idx - 1] as StepPath);
    } else {
      // Step 1's "back" goes home. Use router.back() if there's
      // history so the page doesn't re-fetch unnecessarily.
      if (typeof window !== "undefined" && window.history.length > 1) {
        router.back();
      } else {
        router.push("/");
      }
    }
  };

  const progressPct = (stepNum / total) * 100;
  const defaultIllo = illustrationKeyFor(pathname);
  const [override, setOverride] = useState<StepKey | null>(null);
  // Reset al cambiar de paso para que la página nueva parta del default.
  useEffect(() => { setOverride(null); }, [pathname]);
  const ctxValue = useMemo(() => ({ set: setOverride }), []);

  return (
    <IllustrationOverrideCtx.Provider value={ctxValue}>
    <div
      className="min-h-[100dvh] bg-white text-slate-900"
      style={{ overscrollBehavior: "contain" }}
    >
      <IllustrationPanel step={override ?? defaultIllo}>
        <div className="flex flex-col min-h-[100dvh]">
          {/* ── Sticky header ───────────────────────────── */}
          <header
            className="sticky top-0 z-40 backdrop-blur bg-white/95 border-b border-slate-100"
            style={{ paddingTop: "env(safe-area-inset-top)" }}
          >
            <div className="mx-auto max-w-xl flex items-center justify-between gap-2 h-14 px-3">
              <button
                type="button"
                onClick={onBack}
                className="h-10 w-10 inline-flex items-center justify-center rounded-full
                           text-slate-700 hover:bg-slate-100 active:scale-95 transition"
                aria-label={idx > 0 ? "Paso anterior" : "Volver al inicio"}
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M15 18l-6-6 6-6" />
                </svg>
              </button>

              <BrandLogo size="sm" href="/" />

              <Link
                href="/"
                className="h-10 w-10 inline-flex items-center justify-center rounded-full
                           text-slate-700 hover:bg-slate-100 active:scale-95 transition"
                aria-label="Cerrar y volver al inicio"
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6"  y1="6" x2="18" y2="18" />
                </svg>
              </Link>
            </div>
            {/* Progress strip */}
            <div className="h-1 bg-slate-100">
              <div
                className="h-full bg-warm transition-[width] duration-300 ease-out"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </header>

          <main className="flex-1 mx-auto w-full max-w-xl">
            {children}
          </main>
        </div>
      </IllustrationPanel>
    </div>
    </IllustrationOverrideCtx.Provider>
  );
}

/**
 * Wrapper for every step's content. Renders the heading area + a
 * scrollable body, and pins a primary CTA to the bottom of the
 * viewport with safe-area padding.
 *
 * If `onContinue` is omitted, no CTA renders (used by step 1 where
 * tapping a slot directly advances).
 */
export function StepFrame({
  title,
  subtitle,
  children,
  onContinue,
  canContinue = true,
  ctaLabel = "Continuar",
  loading = false,
}: {
  // ReactNode (no solo string) — permite <em>, <strong>, spans con
  // clases y cualquier layout inline dentro del h1/p del header.
  title:        React.ReactNode;
  subtitle?:    React.ReactNode;
  children:     React.ReactNode;
  onContinue?:  () => void;
  canContinue?: boolean;
  ctaLabel?:    string;
  loading?:     boolean;
}) {
  // Reserve room at the bottom so the fixed CTA never covers content.
  // 5.5rem (88px) ≈ button height (48) + vertical padding + a bit of slack.
  const bottomPad = onContinue
    ? "pb-[calc(env(safe-area-inset-bottom)+5.5rem)]"
    : "pb-[env(safe-area-inset-bottom)]";

  return (
    <>
      <div className={`px-5 pt-5 ${bottomPad}`}>
        <h1 className="text-[26px] sm:text-3xl font-extrabold tracking-tight text-slate-900">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-1.5 text-[15px] text-slate-600 leading-relaxed">
            {subtitle}
          </p>
        )}
        <div className="mt-5">
          {children}
        </div>
      </div>

      {onContinue && (
        <div
          className="fixed bottom-0 left-0 right-0 md:left-1/2 z-30
                     bg-gradient-to-t from-white via-white/95 to-white/0
                     pt-6"
        >
          <div
            className="mx-auto max-w-xl px-5 pb-4"
            style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1rem)" }}
          >
            <button
              type="button"
              onClick={() => {
                if (!canContinue || loading) return;
                if (typeof navigator !== "undefined" && "vibrate" in navigator) {
                  try { navigator.vibrate?.(8); } catch { /* iOS quietly no-ops */ }
                }
                onContinue();
              }}
              disabled={!canContinue || loading}
              className="w-full h-12 rounded-2xl bg-warm text-warm-foreground font-semibold text-base
                         shadow-lg shadow-warm/20 active:scale-[0.98] transition
                         disabled:opacity-50 disabled:active:scale-100"
            >
              {loading ? "Enviando…" : ctaLabel}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

// Re-export step list so consumers (e.g. submit handler) can navigate
// without hardcoding URLs.
export const FUNNEL_STEPS = STEP_PATHS;

export function useNextStep() {
  const pathname = usePathname() ?? "/agendar/cuando";
  const router   = useRouter();
  const idx      = stepIndexFor(pathname);

  return useMemo(() => ({
    next: () => {
      if (idx < STEP_PATHS.length - 1) router.push(STEP_PATHS[idx + 1] as StepPath);
    },
    isLast: idx === STEP_PATHS.length - 1,
  }), [idx, router]);
}
