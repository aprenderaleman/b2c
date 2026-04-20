"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export type LiveClassInfo = {
  classId:     string;
  title:       string;
  teacherName: string;
  startedAt:   string;
};

/**
 * Big pulsing green CTA that appears at the top of the student
 * dashboard the instant a teacher clicks "Iniciar clase ahora". Polls
 * /api/student/live-class every 15s and on window focus, so the CTA
 * appears/disappears without the student having to reload.
 *
 * Initial render is SSR-hydrated (so reload-into-dashboard is instant,
 * no loading flash). After hydration the poll keeps it fresh.
 */
export function LiveClassCta({ initial }: { initial: LiveClassInfo | null }) {
  const [live, setLive] = useState<LiveClassInfo | null>(initial);

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const res = await fetch("/api/student/live-class", { cache: "no-store" });
        if (!res.ok) return;
        const d = (await res.json()) as { live: LiveClassInfo | null };
        if (!cancelled) setLive(d?.live ?? null);
      } catch {
        /* network blips: swallow, keep last state */
      }
    }
    const id = setInterval(refresh, 15_000);
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    // Don't run an initial fetch: SSR already populated `initial`,
    // refetching immediately would cause a pointless render.
    return () => {
      cancelled = true;
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  if (!live) return null;

  const startedMs = new Date(live.startedAt).getTime();
  const elapsedMin = Math.max(0, Math.round((Date.now() - startedMs) / 60_000));

  return (
    <Link
      href={`/aula/${live.classId}`}
      className="block rounded-3xl p-5
                 bg-gradient-to-r from-emerald-500 to-emerald-600
                 hover:from-emerald-600 hover:to-emerald-700
                 text-white shadow-lg
                 border border-emerald-400/40
                 transition-all focus:outline-none focus:ring-4 focus:ring-emerald-300/40"
    >
      <div className="flex items-center gap-4">
        <span className="relative flex h-3 w-3 shrink-0" aria-hidden>
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white/80" />
          <span className="relative inline-flex h-3 w-3 rounded-full bg-white" />
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-[11px] uppercase tracking-wider text-white/85 font-semibold">
            En directo ahora
            {elapsedMin > 0 && <span className="ml-2 font-normal">· empezó hace {elapsedMin} min</span>}
          </div>
          <div className="mt-0.5 text-base sm:text-lg font-bold truncate">{live.title}</div>
          <div className="text-xs sm:text-sm text-white/90 truncate">
            Con {live.teacherName} — tu profesor/a te está esperando
          </div>
        </div>
        <span className="shrink-0 inline-flex items-center gap-1.5 rounded-full
                         bg-white text-emerald-700 hover:bg-white/95
                         px-4 py-2 text-sm font-semibold shadow">
          Entrar ahora →
        </span>
      </div>
    </Link>
  );
}
