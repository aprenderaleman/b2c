"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SignAgreementButton } from "./SignAgreementModal";

/** Ver / (re)enviar el Acuerdo de Colaboración del profe (admin). */
export function AgreementActions({ teacherId, sent, signedAt }: { teacherId: string; sent: boolean; signedAt?: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg]   = useState<string | null>(null);

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
      {msg && <span className="text-slate-500">{msg}</span>}
    </div>
  );
}
