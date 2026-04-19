"use client";

import { useEffect, useRef, useState } from "react";

type Status = "green" | "yellow" | "red";

type Service = {
  service:       string;
  last_tick:     string;
  minutes_since: number;
  last_note:     string | null;
  state:         Status;
};

type HealthResponse = {
  status:   Status;
  critical: string | null;
  services: Service[];
  infra?:   { livekit?: { configured: boolean; url: string | null } };
};

const POLL_MS = 30_000;   // 30 s — cheap: 2 tiny DB queries per poll

/**
 * Small coloured dot in the admin header that reflects the self-healing
 * status in real time:
 *
 *    🟢  green   = every heartbeat fresh, no critical banner
 *    🟡  yellow  = at least one heartbeat in the warn zone (20-30 min)
 *    🔴  red     = a service is stale (>30 min) or the janitor raised
 *                  a critical issue
 *
 * Click to open a popover with the details (which services, when was
 * their last tick, and the critical message if any).
 */
export function SystemHealthDot() {
  const [data, setData]   = useState<HealthResponse | null>(null);
  const [open, setOpen]   = useState(false);
  const [error, setError] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  const load = async () => {
    try {
      const res = await fetch("/api/admin/health", { cache: "no-store" });
      if (!res.ok) { setError(true); return; }
      setError(false);
      const json: HealthResponse = await res.json();
      setData(json);
    } catch {
      setError(true);
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, []);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const status: Status = error ? "red" : (data?.status ?? "green");
  const label =
    status === "green"  ? "Sistema 100% operativo"                      :
    status === "yellow" ? "Atención: algún servicio algo lento"         :
                          "Problema detectado — revisa los detalles";

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-label={label}
        title={label}
        className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-700 dark:text-slate-200 hover:border-slate-300 dark:hover:border-slate-600 transition-colors"
      >
        <Dot status={status} />
        <span className="hidden sm:inline">
          {status === "green"  ? "OK"       :
           status === "yellow" ? "Atención" :
                                 "Error"}
        </span>
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl z-50 overflow-hidden">
          <header className={`px-4 py-3 border-b border-slate-200 dark:border-slate-800 ${headerClass(status)}`}>
            <div className="flex items-center gap-2">
              <Dot status={status} size="lg" />
              <h3 className="text-sm font-bold">{label}</h3>
            </div>
          </header>

          {data?.critical && (
            <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 bg-red-50 dark:bg-red-500/10 text-red-900 dark:text-red-200 text-xs">
              <strong>Alerta:</strong> {stripTs(data.critical)}
            </div>
          )}

          <div className="px-4 py-3">
            <h4 className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold">
              Servicios
            </h4>
            <ul className="mt-2 space-y-1.5">
              {(data?.services ?? []).map(s => (
                <li key={s.service} className="flex items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-2">
                    <Dot status={s.state} />
                    <span className="font-medium text-slate-900 dark:text-slate-50 capitalize">
                      {s.service}
                    </span>
                  </div>
                  <span className="text-slate-500 dark:text-slate-400 font-mono">
                    {formatAge(s.minutes_since)} ago
                  </span>
                </li>
              ))}
              {(!data || data.services.length === 0) && (
                <li className="text-xs text-slate-500 dark:text-slate-400">
                  Sin datos aún. Esperando primer heartbeat…
                </li>
              )}
            </ul>
          </div>

          {data?.infra && (
            <div className="px-4 py-2 border-t border-slate-100 dark:border-slate-800 text-[11px] text-slate-600 dark:text-slate-300 flex items-center gap-2">
              <Dot status={data.infra.livekit?.configured ? "green" : "yellow"} />
              <span>
                LiveKit {data.infra.livekit?.configured ? "configurado" : "sin credenciales"}
              </span>
              {data.infra.livekit?.url && (
                <code className="ml-auto text-[9px] text-slate-400 truncate max-w-[10rem]" title={data.infra.livekit.url}>
                  {data.infra.livekit.url.replace(/^wss?:\/\//, "")}
                </code>
              )}
            </div>
          )}

          <footer className="px-4 py-2 bg-slate-50 dark:bg-slate-800/60 text-[10px] text-slate-500 dark:text-slate-400 flex items-center justify-between">
            <span>Auto-refresca cada 30 s</span>
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

function Dot({ status, size = "sm" }: { status: Status; size?: "sm" | "lg" }) {
  const dim = size === "lg" ? "h-3 w-3" : "h-2.5 w-2.5";
  const color =
    status === "green"  ? "bg-emerald-500" :
    status === "yellow" ? "bg-amber-500"  :
                          "bg-red-500";
  const ring =
    status === "green"  ? "ring-emerald-500/40" :
    status === "yellow" ? "ring-amber-500/40"  :
                          "ring-red-500/40";
  return (
    <span className="relative inline-flex">
      {status === "green" && (
        <span className={`absolute inline-flex h-full w-full rounded-full ${color} opacity-60 animate-ping`} />
      )}
      {status === "red" && (
        <span className={`absolute inline-flex h-full w-full rounded-full ${color} opacity-75 animate-pulse`} />
      )}
      <span className={`relative inline-flex ${dim} rounded-full ${color} ring-2 ${ring}`} />
    </span>
  );
}

function headerClass(s: Status): string {
  if (s === "green")  return "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-900 dark:text-emerald-200";
  if (s === "yellow") return "bg-amber-50   dark:bg-amber-500/10   text-amber-900   dark:text-amber-200";
  return                     "bg-red-50     dark:bg-red-500/10     text-red-900     dark:text-red-200";
}

function formatAge(min: number): string {
  if (min < 1)   return "ahora";
  if (min < 60)  return `${min} min`;
  const h = Math.floor(min / 60);
  return `${h}h ${min % 60}m`;
}

function stripTs(s: string): string {
  const i = s.indexOf("|");
  return i > 0 ? s.slice(i + 1).trim() : s;
}
