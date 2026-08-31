"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

/**
 * "Copiar enlace de reagenda" — para cuando el lead no contesta la
 * llamada: el setter pega el enlace desde SU propio WhatsApp (cero
 * mensajes de Stiv). Regla acordada (Gelfis 2026-08-31): al copiar se
 * registra automáticamente un contacto con canal=whatsapp y nota
 * obligatoria — no existe el "mandé el link" sin registro.
 */
export function CopyRescheduleLink({ leadId, link }: { leadId: string; link: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [note, setNote] = useState("");

  const submit = () => {
    setError(null);
    if (note.trim().length < 5) {
      setError("La nota es obligatoria (mínimo 5 caracteres).");
      return;
    }
    start(async () => {
      const res = await fetch("/api/contacts/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId,
          actionType: "nota_libre",
          channel: "whatsapp",
          note: `🔗 Enlace de reagenda enviado por mi WhatsApp — ${note.trim()}`,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(`No se pudo registrar: ${body?.error ?? "error"}`);
        return;
      }
      try {
        await navigator.clipboard.writeText(link);
        setCopied(true);
      } catch {
        setCopied(true);   // el link queda visible abajo para copiar a mano
      }
      router.refresh();
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => { setOpen(true); setCopied(false); setNote(""); }}
        className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 dark:border-slate-600 px-3 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:border-brand-400 hover:text-brand-600 dark:hover:text-brand-400 transition-colors"
      >
        🔗 Copiar enlace de reagenda
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-5 space-y-4">
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Copiar enlace de reagenda</h3>

            {copied ? (
              <>
                <p className="text-sm text-emerald-700 dark:text-emerald-300">
                  Contacto registrado y enlace copiado. Pégalo en tu WhatsApp:
                </p>
                <code className="block break-all rounded-lg bg-slate-100 dark:bg-slate-800 px-3 py-2 text-xs text-slate-700 dark:text-slate-300">
                  {link}
                </code>
                <div className="flex justify-end">
                  <button type="button" onClick={() => setOpen(false)} className="btn-primary text-sm">Listo</button>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Para cuando el lead no contesta la llamada. El enlace se envía
                  desde <strong>tu</strong> WhatsApp. Al copiar, se registra el
                  contacto automáticamente.
                </p>
                <label className="block text-sm">
                  <span className="font-medium text-slate-700 dark:text-slate-200">Nota (obligatoria)</span>
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={2}
                    className="input-text mt-1 w-full"
                    placeholder="Ej: No contestó 2 llamadas, le mando el link por WhatsApp."
                  />
                </label>
                {error && <p className="text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>}
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setOpen(false)} className="text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 px-3 py-2">
                    Cancelar
                  </button>
                  <button type="button" onClick={submit} disabled={pending} className="btn-primary text-sm">
                    {pending ? "Registrando…" : "Registrar y copiar enlace"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
