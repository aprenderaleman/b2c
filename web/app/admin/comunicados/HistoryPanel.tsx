"use client";

import { useEffect, useState } from "react";

type HistoryRow = {
  id:               string;
  created_at:       string;
  admin_user_id:    string | null;
  audience_filter:  { kind: string;[k: string]: unknown };
  subject:          string;
  channels:         string[];
  total_recipients: number;
  ok_count:         number;
  fail_count:       number;
  status:           "queued" | "sending" | "sent" | "failed" | "cancelled";
  scheduled_at:     string | null;
  attachments:      Array<{ name: string; size: number }> | null;
};

/**
 * Two-section list:
 *   1. Programados (queued)        — top, with Editar / Cancelar.
 *   2. Historial reciente (everything else, newest first).
 *
 * Refreshes whenever the composer emits `comunicados:sent`.
 */
export function HistoryPanel() {
  const [rows, setRows]   = useState<HistoryRow[] | null>(null);
  const [err, setErr]     = useState<string | null>(null);
  const [busyId, setBusy] = useState<string | null>(null);

  const load = async () => {
    try {
      const res  = await fetch("/api/admin/comunicados/history", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) { setErr(data?.message ?? data?.error ?? "Error"); return; }
      setRows(data.broadcasts as HistoryRow[]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error de red.");
    }
  };

  useEffect(() => {
    void load();
    const handler = () => { void load(); };
    window.addEventListener("comunicados:sent", handler);
    return () => window.removeEventListener("comunicados:sent", handler);
  }, []);

  const handleCancel = async (id: string) => {
    if (!confirm("¿Cancelar este envío programado?")) return;
    setBusy(id);
    try {
      const res = await fetch("/api/admin/comunicados/cancel", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data?.error === "not_cancelable"
          ? "Ya no se puede cancelar — el envío ha empezado o ha terminado."
          : (data?.message ?? data?.error ?? "Error al cancelar."));
      }
      await load();
    } finally {
      setBusy(null);
    }
  };

  const queued    = (rows ?? []).filter(r => r.status === "queued");
  const recent    = (rows ?? []).filter(r => r.status !== "queued");

  return (
    <>
      {/* Scheduled (queued) section */}
      <section className="surface-card p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
            📅 Programados
          </h2>
          <button type="button" onClick={() => void load()} className="text-xs text-brand-600 hover:underline">
            Actualizar
          </button>
        </div>

        {rows === null && !err && (
          <p className="mt-3 text-sm text-slate-500">Cargando…</p>
        )}
        {rows && queued.length === 0 && (
          <p className="mt-3 text-sm text-slate-500">No hay envíos programados.</p>
        )}
        {queued.length > 0 && (
          <ul className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
            {queued.map(r => (
              <li key={r.id} className="py-3 grid grid-cols-[1fr_auto] gap-3 items-baseline">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                    {r.subject || "(sin asunto)"}
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    📅 <strong>{r.scheduled_at ? formatDate(r.scheduled_at) : "?"}</strong>
                    {" · "}{describeAudience(r.audience_filter)} · {r.channels.join("+")}
                    {r.attachments && r.attachments.length > 0 && (
                      <> · 📎 {r.attachments.length}</>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <a
                    href={`/admin/comunicados?edit=${r.id}`}
                    className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-brand-400 hover:text-brand-600 transition-colors"
                  >
                    Editar
                  </a>
                  <button
                    type="button"
                    onClick={() => void handleCancel(r.id)}
                    disabled={busyId === r.id}
                    className="text-xs px-3 py-1.5 rounded-lg border border-red-200 dark:border-red-700/50 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50"
                  >
                    {busyId === r.id ? "Cancelando…" : "Cancelar"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Sent / failed / cancelled section */}
      <section className="surface-card p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
          Historial reciente
        </h2>
        {err && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{err}</p>}
        {rows && recent.length === 0 && !err && (
          <p className="mt-3 text-sm text-slate-500">Todavía no has enviado ningún comunicado.</p>
        )}
        {recent.length > 0 && (
          <ul className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
            {recent.map(r => {
              const isCancelled = r.status === "cancelled";
              const isFailed    = r.status === "failed";
              return (
                <li key={r.id} className={`py-3 grid grid-cols-[1fr_auto] gap-3 items-baseline ${isCancelled ? "opacity-60" : ""}`}>
                  <div className="min-w-0">
                    <div className={`text-sm font-medium text-slate-900 dark:text-slate-100 truncate ${isCancelled ? "line-through" : ""}`}>
                      {r.subject || "(sin asunto)"}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      {statusBadge(r.status)} · {describeAudience(r.audience_filter)} · {r.channels.join("+")} · {formatDate(r.created_at)}
                      {r.attachments && r.attachments.length > 0 && (
                        <> · 📎 {r.attachments.length}</>
                      )}
                    </div>
                  </div>
                  <div className="text-xs font-mono text-slate-600 dark:text-slate-300">
                    {!isCancelled && (
                      <>
                        <span className={isFailed ? "text-red-600" : "text-emerald-600"}>{r.ok_count}✓</span>
                        {r.fail_count > 0 && <> · <span className="text-red-600">{r.fail_count}✗</span></>}
                        {" / "}{r.total_recipients}
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}

function describeAudience(f: HistoryRow["audience_filter"]): string {
  const kind = f?.kind;
  if (kind === "all_students") return `Estudiantes (${(f.status as string) ?? "active"})`;
  if (kind === "all_teachers") return "Profesores";
  if (kind === "level")        return `Nivel ${f.level as string}`;
  if (kind === "group")        return "Grupo";
  if (kind === "leads") {
    const groups = Array.isArray(f.status_groups) ? (f.status_groups as string[]) : [];
    return groups.length > 0 ? `Leads (${groups.length})` : "Leads";
  }
  if (kind === "custom")       return "Custom";
  return String(kind ?? "?");
}

function statusBadge(s: HistoryRow["status"]): string {
  switch (s) {
    case "sent":      return "✓ enviado";
    case "failed":    return "✗ fallido";
    case "cancelled": return "✕ cancelado";
    case "sending":   return "↻ enviando";
    default:          return s;
  }
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}
