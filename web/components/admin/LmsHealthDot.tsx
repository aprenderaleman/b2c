"use client";

import { useEffect, useRef, useState } from "react";

type LmsHealth = {
  livekit_configured: boolean;
  db_ok:              boolean;
  upcoming_7d:        number;
  stuck_live_classes: number;
  ok:                 boolean;
};

const POLL_MS = 60_000;

/**
 * Blue dot for LMS-specific liveness (as opposed to the WhatsApp-agents
 * green dot). Blue ⇒ LiveKit configured, DB responsive, at least one
 * upcoming class this week, nothing stuck in 'live'. Red ⇒ at least one
 * invariant broken.
 */
export function LmsHealthDot() {
  const [data, setData] = useState<LmsHealth | null>(null);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  const load = async () => {
    try {
      const res = await fetch("/api/admin/health", { cache: "no-store" });
      if (!res.ok) { setError(true); return; }
      setError(false);
      const json = await res.json();
      setData(json.lms as LmsHealth);
    } catch {
      setError(true);
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const healthy = !error && !!data?.ok;
  const label = healthy ? "LMS operativo al 100%" : "LMS con alguna advertencia";

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-label={label}
        title={label}
        className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-700 dark:text-slate-200 hover:border-slate-300 dark:hover:border-slate-600 transition-colors"
      >
        <BlueDot ok={healthy} />
        <span className="hidden sm:inline">LMS</span>
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl z-50 overflow-hidden">
          <header className={`px-4 py-3 border-b border-slate-200 dark:border-slate-800
            ${healthy
              ? "bg-sky-50 dark:bg-sky-500/10 text-sky-900 dark:text-sky-200"
              : "bg-amber-50 dark:bg-amber-500/10 text-amber-900 dark:text-amber-200"}`}>
            <div className="flex items-center gap-2">
              <BlueDot ok={healthy} size="lg" />
              <h3 className="text-sm font-bold">{label}</h3>
            </div>
          </header>

          <ul className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
            <Check ok={!!data?.db_ok}              label="Base de datos responde" />
            <Check ok={!!data?.livekit_configured} label="LiveKit configurado" />
            <Check ok={(data?.upcoming_7d ?? 0) > 0}
                   label={`Clases próximas (7 días): ${data?.upcoming_7d ?? "…"}`} />
            <Check ok={(data?.stuck_live_classes ?? 0) === 0}
                   label={
                     (data?.stuck_live_classes ?? 0) === 0
                       ? "Ninguna clase colgada en 'live'"
                       : `${data?.stuck_live_classes} clase(s) colgada(s) en 'live' > 3h`
                   } />
          </ul>

          <footer className="px-4 py-2 bg-slate-50 dark:bg-slate-800/60 text-[10px] text-slate-500 dark:text-slate-400 flex items-center justify-between">
            <span>Auto-refresca cada 60 s</span>
            <button
              type="button"
              onClick={() => load()}
              className="text-brand-600 dark:text-brand-400 hover:underline"
            >
              Actualizar
            </button>
          </footer>
        </div>
      )}
    </div>
  );
}

function BlueDot({ ok, size = "sm" }: { ok: boolean; size?: "sm" | "lg" }) {
  const dim   = size === "lg" ? "h-3 w-3" : "h-2.5 w-2.5";
  const color = ok ? "bg-sky-500" : "bg-amber-500";
  const ring  = ok ? "ring-sky-500/40" : "ring-amber-500/40";
  return (
    <span className="relative inline-flex">
      {ok && (
        <span className={`absolute inline-flex h-full w-full rounded-full ${color} opacity-60 animate-ping`} />
      )}
      <span className={`relative inline-flex ${dim} rounded-full ${color} ring-2 ${ring}`} />
    </span>
  );
}

function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2 px-4 py-2 text-slate-800 dark:text-slate-100">
      <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full shrink-0
        ${ok ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300"
              : "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300"}`} aria-hidden>
        {ok ? "✓" : "!"}
      </span>
      <span className="text-xs">{label}</span>
    </li>
  );
}
