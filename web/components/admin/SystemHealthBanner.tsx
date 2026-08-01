"use client";

import { useEffect, useState } from "react";

const POLL_MS = 30_000;

type Health = { critical: string; stale: string[] };

export function SystemHealthBanner() {
  const [data, setData] = useState<Health | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/admin/system-health")
        .then((r) => r.json())
        .then((d: Health) => { if (alive) setData(d); })
        .catch(() => {});
    load();
    const id = setInterval(load, POLL_MS);
    return () => { alive = false; clearInterval(id); };
  }, []);

  if (!data || (!data.critical && data.stale.length === 0)) return null;

  return (
    <div className="sticky top-14 z-30 border-b border-red-300 dark:border-red-500/40 bg-red-50 dark:bg-red-500/10 text-red-900 dark:text-red-200 text-sm">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-2 flex items-start gap-3">
        <span className="text-lg leading-none" aria-hidden>🚨</span>
        <div className="flex-1 min-w-0">
          {data.critical && (
            <div className="font-medium break-words">{stripTimestamp(data.critical)}</div>
          )}
          {data.stale.length > 0 && (
            <div className={data.critical ? "mt-1 text-xs" : "text-sm"}>
              Heartbeat caído en: {data.stale.join(", ")}{" "}
              (hace &gt;30 min).
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function stripTimestamp(s: string): string {
  const i = s.indexOf("|");
  return i > 0 ? s.slice(i + 1).trim() : s;
}
