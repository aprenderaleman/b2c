"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo } from "react";

/**
 * Mobile-first app-shell for the booking funnel.
 *
 * Wraps every /agendar/* page with a sticky top bar (back · step n/4 ·
 * close) and a thin progress strip. The page itself is responsible
 * for its own scrollable content + sticky bottom CTA via <StepFrame>.
 *
 * Desktop visitors hitting /agendar will see the same shell — that's
 * fine, it scales gracefully (centered, max-width). The legacy
 * embedded funnel on `/` remains untouched.
 */

const STEP_PATHS = ["/agendar/cuando", "/agendar/tu", "/agendar/nivel", "/agendar/objetivo"] as const;
type StepPath = typeof STEP_PATHS[number];

function stepIndexFor(pathname: string): number {
  const idx = (STEP_PATHS as readonly string[]).indexOf(pathname);
  return idx >= 0 ? idx : 0;
}

export function FunnelShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/agendar/cuando";
  const router   = useRouter();
  const idx      = stepIndexFor(pathname);
  const stepNum  = idx + 1;
  const total    = STEP_PATHS.length;

  // Theme-color flips to navy for the funnel so the OS status bar
  // (Android Chrome) blends with our header. We inject our OWN meta
  // (no `media` attr) so it overrides the prefers-color-scheme metas
  // set by the root layout. Cleaned up on unmount so the rest of the
  // site keeps its default theme.
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.setAttribute("name",    "theme-color");
    meta.setAttribute("content", "#0F2847");
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

  return (
    <div
      className="theme-dark min-h-[100dvh] bg-navy-900 text-white flex flex-col"
      style={{ overscrollBehavior: "contain" }}
    >
      {/* ── Sticky header ───────────────────────────────── */}
      <header
        className="sticky top-0 z-40 backdrop-blur bg-navy-900/95 border-b border-white/5"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <div className="mx-auto max-w-xl flex items-center justify-between gap-2 h-14 px-3">
          <button
            type="button"
            onClick={onBack}
            className="h-10 w-10 inline-flex items-center justify-center rounded-full
                       text-white/85 hover:bg-white/10 active:scale-95 transition"
            aria-label={idx > 0 ? "Paso anterior" : "Volver al inicio"}
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>

          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-white/70">
            Paso {stepNum} de {total}
          </div>

          <Link
            href="/"
            className="h-10 w-10 inline-flex items-center justify-center rounded-full
                       text-white/85 hover:bg-white/10 active:scale-95 transition"
            aria-label="Cerrar y volver al inicio"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6"  y1="6" x2="18" y2="18" />
            </svg>
          </Link>
        </div>
        {/* Progress strip */}
        <div className="h-0.5 bg-white/5">
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
  title:        string;
  subtitle?:    string;
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
        <h1 className="text-[26px] sm:text-3xl font-extrabold tracking-tight text-white">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-1.5 text-[15px] text-white/70 leading-relaxed">
            {subtitle}
          </p>
        )}
        <div className="mt-5">
          {children}
        </div>
      </div>

      {onContinue && (
        <div
          className="fixed bottom-0 left-0 right-0 z-30
                     bg-gradient-to-t from-navy-900 via-navy-900/95 to-navy-900/0
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
                // Subtle haptic where supported — feels app-native.
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
