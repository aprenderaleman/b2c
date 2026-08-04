"use client";

import { useState } from "react";

type Inv = {
  id:              string;
  code:            string;
  email:           string | null;
  name:            string | null;
  notes:           string | null;
  rate_individual: number | null;
  rango:           string;
  accepts_trials:  boolean;
  created_at:      string;
  expires_at:      string;
  last_sent_at:    string | null;
  status:          "pendiente" | "completada" | "expirada" | "revocada";
  url:             string;
};

const RANGOS = [
  { value: "starter", label: "Starter (5%)" },
  { value: "pro",     label: "Pro (8%)" },
  { value: "elite",   label: "Elite (12%)" },
  { value: "master",  label: "Master (15%)" },
];

const STATUS_STYLE: Record<Inv["status"], string> = {
  pendiente:  "bg-amber-100 dark:bg-amber-500/15 text-amber-800 dark:text-amber-200",
  completada: "bg-emerald-100 dark:bg-emerald-500/15 text-emerald-800 dark:text-emerald-200",
  expirada:   "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300",
  revocada:   "bg-red-100 dark:bg-red-500/15 text-red-700 dark:text-red-300",
};

export function InviteTeacherPanel({ initialInvitations }: { initialInvitations: Inv[] }) {
  const [list, setList]             = useState<Inv[]>(initialInvitations);
  const [email, setEmail]           = useState("");
  const [name, setName]             = useState("");
  const [rate, setRate]             = useState("");
  const [rango, setRango]           = useState("starter");
  const [acceptsTrials, setTrials]  = useState(false);
  const [notes, setNotes]           = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [lastResult, setLastResult] = useState<{ url: string; emailSent: boolean } | null>(null);
  const [copyState, setCopyState]   = useState<Record<string, "copied" | null>>({});
  const [resending, setResending]   = useState<Record<string, boolean>>({});
  const [err, setErr]               = useState<string | null>(null);

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const canSubmit  = emailValid && Number(rate) > 0 && !submitting;

  async function refresh() {
    const r = await fetch("/api/admin/teacher-invitations");
    const d = await r.json();
    if (d.ok) setList(d.invitations);
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setLastResult(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/teacher-invitations", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email:           email.trim().toLowerCase(),
          name:            name.trim() || undefined,
          rate_individual: Number(rate),
          rango,
          accepts_trials:  acceptsTrials,
          notes:           notes.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setErr(data.error ?? "No se pudo crear la invitación.");
      } else {
        setLastResult({ url: data.url, emailSent: data.email_sent });
        if (!data.email_sent && data.email_error) {
          setErr(`Invitación creada pero el email falló (${data.email_error}). Copia el link y envíalo manualmente.`);
        }
        setEmail(""); setName(""); setRate(""); setRango("starter");
        setTrials(false); setNotes("");
        await refresh();
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error de conexión.");
    } finally {
      setSubmitting(false);
    }
  }

  async function onResend(id: string) {
    setResending(s => ({ ...s, [id]: true }));
    try {
      const res = await fetch(`/api/admin/teacher-invitations/${id}/resend`, { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        alert(`No se pudo reenviar: ${data.email_error ?? data.error ?? "error"}`);
      }
      await refresh();
    } finally {
      setResending(s => ({ ...s, [id]: false }));
    }
  }

  async function onRevoke(id: string) {
    if (!confirm("Revocar esta invitación? El link dejará de funcionar.")) return;
    const res = await fetch(`/api/admin/teacher-invitations/${id}/revoke`, { method: "POST" });
    if (res.ok) await refresh();
  }

  function copy(id: string, url: string) {
    navigator.clipboard.writeText(url).then(() => {
      setCopyState(s => ({ ...s, [id]: "copied" }));
      setTimeout(() => setCopyState(s => ({ ...s, [id]: null })), 1500);
    });
  }

  const inputCls = "mt-1 w-full h-10 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500";
  const labelCls = "block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400";

  return (
    <div className="space-y-6">
      {/* Formulario de invitación */}
      <form
        onSubmit={onCreate}
        className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 space-y-4"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelCls}>Email del candidato *</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)}
              placeholder="profe@ejemplo.com" className={inputCls} required />
          </div>
          <div>
            <label className={labelCls}>Nombre <span className="font-normal normal-case opacity-60">(para el email)</span></label>
            <input type="text" value={name} onChange={e => setName(e.target.value)}
              placeholder="Sabine" maxLength={120} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Tarifa individual acordada (€/h) *</label>
            <input type="number" step="0.5" min="1" value={rate} onChange={e => setRate(e.target.value)}
              placeholder="14" className={inputCls} required />
          </div>
          <div>
            <label className={labelCls}>Rango de comisión inicial</label>
            <select value={rango} onChange={e => setRango(e.target.value)} className={inputCls}>
              {RANGOS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
        </div>

        <label className="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" checked={acceptsTrials} onChange={e => setTrials(e.target.checked)}
            className="h-4 w-4 accent-brand-500" />
          <span className="text-sm text-slate-700 dark:text-slate-200">
            Recibe clases de prueba desde el primer día
          </span>
        </label>

        <div>
          <label className={labelCls}>Nota interna <span className="font-normal normal-case opacity-60">(opcional)</span></label>
          <input type="text" value={notes} onChange={e => setNotes(e.target.value)}
            placeholder="ej. Candidata recomendada por Sabine" maxLength={200} className={inputCls} />
        </div>

        {err && <p className="text-xs text-red-600 dark:text-red-400">{err}</p>}

        <button type="submit" disabled={!canSubmit}
          className="btn-primary text-sm inline-flex items-center gap-2 disabled:opacity-50">
          {submitting ? "Enviando…" : "📨 Enviar invitación"}
        </button>

        {lastResult && (
          <div className="rounded-lg border border-emerald-200 dark:border-emerald-500/40 bg-emerald-50 dark:bg-emerald-500/10 p-3 text-xs">
            <p className="font-semibold text-emerald-700 dark:text-emerald-300 mb-1.5">
              {lastResult.emailSent
                ? "✓ Invitación enviada por email · válida 14 días"
                : "✓ Invitación creada · válida 14 días"}
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 break-all text-emerald-900 dark:text-emerald-200">{lastResult.url}</code>
              <button type="button" onClick={() => copy("last", lastResult.url)}
                className="shrink-0 text-emerald-700 dark:text-emerald-200 hover:underline">
                {copyState["last"] === "copied" ? "✓ Copiado" : "📋 Copiar link"}
              </button>
            </div>
          </div>
        )}
      </form>

      {/* Tabla de invitaciones */}
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-3">
          Invitaciones ({list.length})
        </h2>
        {list.length === 0 ? (
          <p className="text-sm text-slate-400 italic">Ninguna invitación todavía.</p>
        ) : (
          <ul className="space-y-2">
            {list.map(inv => {
              const expiresIn = Math.ceil((new Date(inv.expires_at).getTime() - Date.now()) / 86_400_000);
              const canResend = inv.status === "pendiente" || inv.status === "expirada";
              return (
                <li key={inv.id} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className={`text-[11px] font-bold uppercase rounded-full px-2 py-0.5 ${STATUS_STYLE[inv.status]}`}>
                          {inv.status}
                        </span>
                        <span className="font-semibold text-slate-900 dark:text-white">
                          {inv.name ? `${inv.name} · ` : ""}{inv.email}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400">
                        {inv.rate_individual != null && <span>💶 {inv.rate_individual}€/h</span>}
                        <span>🏅 {inv.rango}</span>
                        {inv.accepts_trials && <span>🧪 trials</span>}
                        <span>creada {new Date(inv.created_at).toLocaleDateString("es-ES")}</span>
                        {inv.status === "pendiente" && (
                          <span>expira en {expiresIn} {expiresIn === 1 ? "día" : "días"}</span>
                        )}
                        {inv.last_sent_at && (
                          <span>último envío {new Date(inv.last_sent_at).toLocaleDateString("es-ES")}</span>
                        )}
                      </div>
                      {inv.notes && (
                        <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{inv.notes}</p>
                      )}
                    </div>
                    <div className="flex flex-col gap-1.5 shrink-0">
                      {inv.status !== "revocada" && inv.status !== "completada" && (
                        <button type="button" onClick={() => copy(inv.id, inv.url)}
                          className="text-xs rounded-md bg-brand-100 dark:bg-brand-500/15 text-brand-800 dark:text-brand-200 px-2 py-1 hover:bg-brand-200 dark:hover:bg-brand-500/25">
                          {copyState[inv.id] === "copied" ? "✓ Copiado" : "📋 Copiar"}
                        </button>
                      )}
                      {canResend && (
                        <button type="button" onClick={() => onResend(inv.id)} disabled={resending[inv.id]}
                          className="text-xs rounded-md border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 px-2 py-1 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50">
                          {resending[inv.id] ? "Enviando…" : "↻ Reenviar"}
                        </button>
                      )}
                      {inv.status === "pendiente" && (
                        <button type="button" onClick={() => onRevoke(inv.id)}
                          className="text-xs rounded-md border border-red-200 dark:border-red-500/40 text-red-700 dark:text-red-300 px-2 py-1 hover:bg-red-50 dark:hover:bg-red-500/10">
                          Revocar
                        </button>
                      )}
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
