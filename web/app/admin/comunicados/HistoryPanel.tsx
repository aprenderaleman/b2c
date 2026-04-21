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
};

/**
 * Read-only list of the last 20 broadcasts. Refreshes whenever the
 * composer emits a `comunicados:sent` custom event (after a send).
 */
export function HistoryPanel() {
  const [rows, setRows]       = useState<HistoryRow[] | null>(null);
  const [err, setErr]         = useState<string | null>(null);

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

  return (
    <section className="surface-card p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
          Historial (últimos 20)
        </h2>
        <button type="button" onClick={() => void load()} className="text-xs text-brand-600 hover:underline">
          Actualizar
        </button>
      </div>

      {err && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{err}</p>}

      {rows === null && !err && (
        <p className="mt-3 text-sm text-slate-500">Cargando…</p>
      )}

      {rows && rows.length === 0 && (
        <p className="mt-3 text-sm text-slate-500">Todavía no has enviado ningún comunicado.</p>
      )}

      {rows && rows.length > 0 && (
        <ul className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
          {rows.map(r => (
            <li key={r.id} className="py-3 grid grid-cols-[1fr_auto] gap-3 items-baseline">
              <div className="min-w-0">
                <div className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                  {r.subject || "(sin asunto)"}
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  {describeAudience(r.audience_filter)} · {r.channels.join("+")} · {formatDate(r.created_at)}
                </div>
              </div>
              <div className="text-xs font-mono text-slate-600 dark:text-slate-300">
                <span className="text-emerald-600">{r.ok_count}✓</span>
                {r.fail_count > 0 && <> · <span className="text-red-600">{r.fail_count}✗</span></>}
                {" / "}{r.total_recipients}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function describeAudience(f: HistoryRow["audience_filter"]): string {
  const kind = f?.kind;
  if (kind === "all_students") return `Estudiantes (${(f.status as string) ?? "active"})`;
  if (kind === "all_teachers") return "Profesores";
  if (kind === "level")        return `Nivel ${f.level as string}`;
  if (kind === "group")        return "Grupo";
  if (kind === "custom")       return "Custom";
  return String(kind ?? "?");
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}
