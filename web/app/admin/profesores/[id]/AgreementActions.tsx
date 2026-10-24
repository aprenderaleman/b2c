"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SignAgreementButton } from "./SignAgreementModal";

/** Ver / (re)enviar el Acuerdo de Colaboración del profe (admin). */
export function AgreementActions({ teacherId, sent, signedAt, receivedAt }: { teacherId: string; sent: boolean; signedAt?: string | null; receivedAt?: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg]   = useState<string | null>(null);

  const markReceived = async () => {
    if (!confirm("¿Confirmas que el profesor devolvió el acuerdo firmado?")) return;
    setBusy(true); setMsg(null);
    try {
      const res = await fetch(`/api/admin/teachers/${teacherId}/agreement/received`, { method: "POST" });
      setMsg(res.ok ? "Registrado ✓" : `Error ${res.status}`);
      if (res.ok) router.refresh();
    } finally { setBusy(false); }
  };

  const send = async () => {
    if (!confirm(`${sent ? "Reenviar" : "Enviar"} el Acuerdo de Colaboración por email al profesor?`)) return;
    setBusy(true); setMsg(null);
    try {
      const res = await fetch(`/api/admin/teachers/${teacherId}/agreement`, { method: "POST" });
      const d = await res.json().catch(() => ({}));
      setMsg(res.ok ? "Enviado ✓" : `Error: ${d.error ?? res.status}`);
      if (res.ok) router.refresh();
    } finally { setBusy(false); }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <a href={`/api/admin/teachers/${teacherId}/agreement`} target="_blank" rel="noopener noreferrer"
         className="rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-1.5 font-medium hover:bg-slate-50 dark:hover:bg-slate-800">
        Ver PDF
      </a>
      <SignAgreementButton teacherId={teacherId} signed={!!signedAt} small />
      <button type="button" onClick={send} disabled={busy}
              className="rounded-lg bg-brand-500 px-3 py-1.5 font-semibold text-white hover:bg-brand-600 disabled:opacity-60">
        {busy ? "Enviando…" : sent ? "Reenviar por email" : "Enviar por email"}
      </button>
      {receivedAt
        ? <span className="rounded-lg bg-emerald-50 dark:bg-emerald-500/10 px-2 py-1 text-emerald-700 dark:text-emerald-300">Firmado por el profe ✓ {new Date(receivedAt).toLocaleDateString("es-ES")}</span>
        : <button type="button" onClick={markReceived} disabled={busy} className="rounded-lg border border-emerald-300 px-3 py-1.5 font-medium text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 disabled:opacity-60">Acuerdo firmado recibido</button>}
      {msg && <span className="text-slate-500">{msg}</span>}
    </div>
  );
}
