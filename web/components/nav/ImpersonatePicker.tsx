"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type User = { id: string; full_name: string | null; email: string; role: "teacher" | "student" };

/**
 * Modal with a debounced search over active students + teachers. Pick
 * one → POST /impersonate/start → server sets cookie + returns the
 * redirect URL (/estudiante or /profesor). We navigate there.
 */
export function ImpersonatePicker({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ]             = useState("");
  const [results, setResults] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [pending, start]      = useTransition();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/admin/picker?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        setResults(Array.isArray(data?.users) ? data.users : []);
      } finally { setLoading(false); }
    }, 180);
    return () => clearTimeout(t);
  }, [q, open]);

  const pick = (u: User) => start(async () => {
    const res = await fetch("/api/admin/impersonate/start", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ target_user_id: u.id }),
    });
    const data = await res.json();
    if (!res.ok) { alert(`No se pudo: ${data?.error ?? "error"}`); return; }
    onClose();
    router.push(data.redirect ?? "/");
    router.refresh();
  });

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal>
      <button type="button" onClick={onClose} className="absolute inset-0 bg-black/60" aria-label="Cerrar" />
      <div className="absolute inset-0 sm:inset-auto sm:left-1/2 sm:top-24 sm:-translate-x-1/2 sm:w-[520px] sm:max-w-[92vw] sm:rounded-3xl bg-white dark:bg-slate-900 sm:border border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col">
        <header className="p-4 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-50">Ver como usuario</h2>
            <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 text-xl leading-none">×</button>
          </div>
          <input
            ref={inputRef}
            type="text"
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Busca por nombre o email…"
            className="mt-3 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-50 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </header>

        <div className="flex-1 overflow-y-auto max-h-[60vh] p-2">
          {loading && <p className="p-4 text-xs text-slate-500">Buscando…</p>}
          {!loading && results.length === 0 && (
            <p className="p-4 text-xs text-slate-500 dark:text-slate-400">
              Escribe al menos 2 letras para empezar a buscar estudiantes y profesores.
            </p>
          )}
          {!loading && results.map(u => (
            <button
              key={u.id}
              type="button"
              disabled={pending}
              onClick={() => pick(u)}
              className="w-full text-left flex items-center gap-3 rounded-xl px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
            >
              <span className={`inline-flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold
                ${u.role === "teacher"
                  ? "bg-brand-100 dark:bg-brand-500/15 text-brand-700 dark:text-brand-300"
                  : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200"}`}>
                {initials(u.full_name ?? u.email)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-slate-900 dark:text-slate-50 truncate">
                  {u.full_name ?? u.email}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                  {u.email} · {u.role === "teacher" ? "Profesor" : "Estudiante"}
                </div>
              </div>
              <span className="text-xs text-brand-600 dark:text-brand-400 shrink-0">Ver →</span>
            </button>
          ))}
        </div>

        <footer className="p-3 border-t border-slate-100 dark:border-slate-800 text-[10px] text-slate-500 dark:text-slate-400">
          Esta acción queda registrada en el log de impersonación. Dura 2 h o hasta que pulses "Volver a mi vista".
        </footer>
      </div>
    </div>
  );
}

function initials(s: string): string {
  return s.split(/\s+/).map(w => w[0]?.toUpperCase() ?? "").slice(0, 2).join("") || "?";
}
