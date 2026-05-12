"use client";

import { useState } from "react";

type Inv = {
  id:         string;
  code:       string;
  email:      string | null;
  notes:      string | null;
  created_at: string;
  expires_at: string;
  url:        string;
};

export function InviteTeacherPanel({ initialInvitations }: { initialInvitations: Inv[] }) {
  const [list, setList]               = useState<Inv[]>(initialInvitations);
  const [email, setEmail]             = useState("");
  const [notes, setNotes]             = useState("");
  const [submitting, setSubmitting]   = useState(false);
  const [lastUrl, setLastUrl]         = useState<string | null>(null);
  const [copyState, setCopyState]     = useState<Record<string, "copied" | null>>({});
  const [err, setErr]                 = useState<string | null>(null);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/teacher-invitations", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ email: email.trim() || undefined, notes: notes.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setErr(data.error ?? "No se pudo crear la invitación.");
      } else {
        setLastUrl(data.url);
        setEmail("");
        setNotes("");
        // Refresh list
        const r2 = await fetch("/api/admin/teacher-invitations");
        const d2 = await r2.json();
        if (d2.ok) setList(d2.invitations);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error de conexión.");
    } finally {
      setSubmitting(false);
    }
  }

  async function onRevoke(id: string) {
    if (!confirm("Revocar esta invitación? El link dejará de funcionar.")) return;
    const res = await fetch(`/api/admin/teacher-invitations/${id}/revoke`, { method: "POST" });
    if (res.ok) setList(prev => prev.filter(x => x.id !== id));
  }

  function copy(id: string, url: string) {
    navigator.clipboard.writeText(url).then(() => {
      setCopyState(s => ({ ...s, [id]: "copied" }));
      setTimeout(() => setCopyState(s => ({ ...s, [id]: null })), 1500);
    });
  }

  return (
    <div className="space-y-6">
      {/* Form para crear nueva */}
      <form
        onSubmit={onCreate}
        className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 space-y-4"
      >
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Email del candidato <span className="font-normal normal-case opacity-60">(opcional · solo memo)</span>
          </label>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="profe@ejemplo.com"
            className="mt-1 w-full h-10 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Nota interna <span className="font-normal normal-case opacity-60">(opcional)</span>
          </label>
          <input
            type="text"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="ej. Candidata recomendada por Sabine"
            maxLength={200}
            className="mt-1 w-full h-10 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        {err && <p className="text-xs text-red-600 dark:text-red-400">{err}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="btn-primary text-sm inline-flex items-center gap-2"
        >
          {submitting ? "Generando…" : "Generar link de invitación"}
        </button>

        {lastUrl && (
          <div className="rounded-lg border border-emerald-200 dark:border-emerald-500/40 bg-emerald-50 dark:bg-emerald-500/10 p-3 text-xs">
            <p className="font-semibold text-emerald-700 dark:text-emerald-300 mb-1.5">
              ✓ Link creado · válido 7 días
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 break-all text-emerald-900 dark:text-emerald-200">{lastUrl}</code>
              <button
                type="button"
                onClick={() => copy("last", lastUrl)}
                className="shrink-0 text-emerald-700 dark:text-emerald-200 hover:underline"
              >
                {copyState["last"] === "copied" ? "✓ Copiado" : "📋 Copiar"}
              </button>
            </div>
          </div>
        )}
      </form>

      {/* Lista de invitaciones activas */}
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-3">
          Invitaciones activas ({list.length})
        </h2>
        {list.length === 0 ? (
          <p className="text-sm text-slate-400 italic">Ninguna invitación pendiente.</p>
        ) : (
          <ul className="space-y-2">
            {list.map(inv => {
              const expiresIn = Math.ceil((new Date(inv.expires_at).getTime() - Date.now()) / 86_400_000);
              return (
                <li key={inv.id} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        {inv.email && (
                          <span className="font-semibold text-slate-900 dark:text-white">{inv.email}</span>
                        )}
                        <span className="text-xs text-slate-500 dark:text-slate-400">
                          expira en {expiresIn} {expiresIn === 1 ? "día" : "días"}
                        </span>
                      </div>
                      {inv.notes && (
                        <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{inv.notes}</p>
                      )}
                      <code className="mt-1.5 block break-all text-[11px] text-slate-500 dark:text-slate-400">
                        {inv.url}
                      </code>
                    </div>
                    <div className="flex flex-col gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => copy(inv.id, inv.url)}
                        className="text-xs rounded-md bg-brand-100 dark:bg-brand-500/15 text-brand-800 dark:text-brand-200 px-2 py-1 hover:bg-brand-200 dark:hover:bg-brand-500/25"
                      >
                        {copyState[inv.id] === "copied" ? "✓ Copiado" : "📋 Copiar"}
                      </button>
                      <button
                        type="button"
                        onClick={() => onRevoke(inv.id)}
                        className="text-xs rounded-md border border-red-200 dark:border-red-500/40 text-red-700 dark:text-red-300 px-2 py-1 hover:bg-red-50 dark:hover:bg-red-500/10"
                      >
                        Revocar
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
