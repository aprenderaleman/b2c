"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Tiny toggle for /admin/{estudiantes,profesores}/[id] that lets the
 * admin opt a specific user out of ALL programmatic pushes — in-app
 * notifications, class reminder emails, future broadcasts. The user
 * can still use the platform normally; we just stop outbound.
 *
 * Built for Sabine who asked to stop receiving everything (2026-04-24),
 * but intentionally generic so any future "please stop emailing me"
 * request can be handled from this toggle without touching code.
 */
export function NotificationsOptOutToggle({
  userId,
  initialOptOut,
  personLabel,
}: {
  userId:        string;
  initialOptOut: boolean;
  personLabel:   string;    // "Sabine Arning" — shown in confirm dialog
}) {
  const router = useRouter();
  const [optOut, setOptOut] = useState(initialOptOut);
  const [pending, start]    = useTransition();
  const [error, setError]   = useState<string | null>(null);

  const toggle = () => {
    const next = !optOut;
    const verb = next ? "SILENCIAR" : "REACTIVAR";
    const msg = next
      ? `${verb} todas las notificaciones y emails para ${personLabel}?\n\nSe puede revertir en cualquier momento.`
      : `${verb} las notificaciones y emails para ${personLabel}?`;
    if (!confirm(msg)) return;

    setError(null);
    start(async () => {
      try {
        const res = await fetch(`/api/admin/users/${userId}/notifications-opt-out`, {
          method:  "PATCH",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ opt_out: next }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data?.message ?? data?.error ?? "No se pudo guardar.");
          return;
        }
        setOptOut(next);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error de red.");
      }
    });
  };

  return (
    <div className={`rounded-2xl border p-4 ${
      optOut
        ? "border-red-300 dark:border-red-500/40 bg-red-50/60 dark:bg-red-500/10"
        : "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"
    }`}>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-50">
            🔔 Notificaciones y emails
          </h3>
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
            {optOut
              ? <><strong className="text-red-700 dark:text-red-300">Silenciado.</strong> No recibe recordatorios de clase, emails de bienvenida ni avisos in-app.</>
              : "Recibe recordatorios de clase (30 min antes) por email e in-app."}
          </p>
        </div>
        <button
          type="button"
          onClick={toggle}
          disabled={pending}
          className={`shrink-0 inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-60 disabled:cursor-wait
            ${optOut
              ? "bg-emerald-500 hover:bg-emerald-600 text-white"
              : "bg-slate-800 hover:bg-slate-900 dark:bg-slate-700 dark:hover:bg-slate-600 text-white"}`}
        >
          {pending ? "Guardando…" : optOut ? "Reactivar" : "Silenciar"}
        </button>
      </div>
      {error && (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400" role="alert">{error}</p>
      )}
    </div>
  );
}
