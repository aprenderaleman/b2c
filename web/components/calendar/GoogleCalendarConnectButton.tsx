"use client";

import { useEffect, useState } from "react";

export function GoogleCalendarConnectButton() {
  const [status, setStatus] = useState<{ connected: boolean; email: string | null } | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);

  useEffect(() => {
    fetch("/api/teacher/google-calendar/status")
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setStatus(d); })
      .catch(() => {});
  }, []);

  if (status === null) return null;

  const handleDisconnect = async () => {
    if (!confirm("¿Desvincular tu Google Calendar?")) return;
    setDisconnecting(true);
    try {
      const res = await fetch("/api/teacher/google-calendar/disconnect", { method: "POST" });
      if (res.ok) setStatus({ connected: false, email: null });
    } catch { /* ignore */ }
    setDisconnecting(false);
  };

  if (status.connected) {
    return (
      <div className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10 px-4 py-2 text-sm">
        <GoogleIcon />
        <span className="text-emerald-700 dark:text-emerald-300 font-medium">
          {status.email ?? "Google Calendar vinculado"}
        </span>
        <button
          type="button"
          onClick={handleDisconnect}
          disabled={disconnecting}
          className="ml-1 text-xs text-slate-500 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 disabled:opacity-50"
        >
          {disconnecting ? "..." : "Desvincular"}
        </button>
      </div>
    );
  }

  return (
    <a
      href="/api/teacher/google-calendar/connect"
      className="inline-flex items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 hover:border-brand-400 hover:text-brand-600 dark:hover:text-brand-400 transition-colors"
    >
      <GoogleIcon />
      Vincular Google Calendar
    </a>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" aria-hidden>
      <path d="M19.5 22h-15A2.5 2.5 0 012 19.5v-15A2.5 2.5 0 014.5 2H8v2H4.5a.5.5 0 00-.5.5v15a.5.5 0 00.5.5h15a.5.5 0 00.5-.5V16h2v3.5a2.5 2.5 0 01-2.5 2.5z" fill="currentColor" opacity=".3" />
      <path d="M17 2h-3v2h3a.5.5 0 01.5.5V8h2V4.5A2.5 2.5 0 0017 2z" fill="#4285F4" />
      <path d="M8 2v2h3V2H8z" fill="#EA4335" />
      <rect x="7" y="10" width="10" height="2" rx="1" fill="#FBBC04" />
      <rect x="7" y="14" width="7" height="2" rx="1" fill="#34A853" />
    </svg>
  );
}
