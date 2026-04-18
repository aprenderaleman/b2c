"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type Notification = {
  id:         string;
  type:       string;
  title:      string;
  body:       string;
  link:       string | null;
  read_at:    string | null;
  created_at: string;
};

/**
 * Bell icon with unread count + dropdown. Polls /api/notifications every
 * 60s so the badge stays fresh without needing Supabase Realtime yet.
 * The dropdown calls /api/notifications/read on open to clear the count.
 */
export function NotificationsBell() {
  const [unread,   setUnread]   = useState(0);
  const [items,    setItems]    = useState<Notification[]>([]);
  const [open,     setOpen]     = useState(false);
  const [loaded,   setLoaded]   = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  // Poll unread count on mount and every minute.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/notifications?count=1");
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setUnread(Number(data.unread ?? 0));
      } catch { /* offline — ignore */ }
    };
    load();
    const t = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(t); };
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

  // Load items + mark-all-read when the dropdown opens.
  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && !loaded) {
      try {
        const res = await fetch("/api/notifications");
        const data = await res.json();
        setItems(data.items ?? []);
        setLoaded(true);
        // Clear the badge optimistically.
        setUnread(0);
        fetch("/api/notifications/read", { method: "POST" }).catch(() => null);
      } catch { /* swallow */ }
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={toggle}
        aria-label={unread > 0 ? `Notificaciones (${unread} sin leer)` : "Notificaciones"}
        className="relative inline-flex h-10 w-10 items-center justify-center rounded-full
                   border border-slate-200 dark:border-slate-700
                   bg-white dark:bg-slate-800
                   text-slate-600 dark:text-slate-300
                   hover:text-brand-600 dark:hover:text-brand-400
                   hover:border-brand-400 dark:hover:border-brand-500
                   transition-colors"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute top-1.5 right-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-500 px-1 text-[10px] font-bold text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl z-50 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800">
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-50">Notificaciones</h3>
          </div>
          <div className="max-h-96 overflow-y-auto">
            {!loaded && <p className="p-4 text-sm text-slate-500 dark:text-slate-400">Cargando…</p>}
            {loaded && items.length === 0 && (
              <p className="p-6 text-center text-sm text-slate-500 dark:text-slate-400">
                Todo al día. Nada nuevo por aquí.
              </p>
            )}
            {loaded && items.map(n => (
              <Link
                key={n.id}
                href={n.link ?? "#"}
                onClick={() => setOpen(false)}
                className={`block px-4 py-3 border-b border-slate-100 dark:border-slate-800 last:border-b-0 transition-colors
                           ${n.read_at ? "" : "bg-brand-50/40 dark:bg-brand-500/5"}
                           hover:bg-slate-50 dark:hover:bg-slate-800/60`}
              >
                <div className="text-sm font-semibold text-slate-900 dark:text-slate-50">{n.title}</div>
                <div className="mt-0.5 text-xs text-slate-600 dark:text-slate-300 line-clamp-2">{n.body}</div>
                <div className="mt-1 text-[10px] text-slate-400">{formatAgo(n.created_at)}</div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function formatAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1)    return "ahora";
  if (mins < 60)   return `hace ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)    return `hace ${hrs} h`;
  const days = Math.floor(hrs / 24);
  if (days < 7)    return `hace ${days} d`;
  return new Date(iso).toLocaleDateString("es-ES");
}
