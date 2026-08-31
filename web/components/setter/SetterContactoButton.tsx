"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

/**
 * Las acciones de registro del setter: confirmación, recordatorio,
 * no contestó y nota. La nota es OBLIGATORIA en todas — no existe el
 * "llamé" sin registro de qué pasó.
 */

const ACTIONS = [
  { value: "confirmar_cita",   label: "✅ Confirmé la cita (hablé con el lead)" },
  { value: "recordatorio_cita", label: "⏰ Recordatorio de cita (llamada o nota de voz)" },
  { value: "no_contesto",      label: "📵 No contestó" },
  { value: "nota_libre",       label: "📝 Nota" },
] as const;

const CHANNELS = [
  { value: "llamada",  label: "Llamada" },
  { value: "whatsapp", label: "WhatsApp (mi número)" },
] as const;

export function SetterContactoButton({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [action, setAction] = useState<string>("confirmar_cita");
  const [channel, setChannel] = useState<string>("llamada");
  const [note, setNote] = useState("");

  const submit = () => {
    setError(null);
    if (note.trim().length < 5) {
      setError("La nota es obligatoria (mínimo 5 caracteres): qué dijo el lead o qué pasó.");
      return;
    }
    start(async () => {
      const res = await fetch("/api/contacts/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId, actionType: action, channel, note: note.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(
          body?.error === "nota_corta"
            ? "La nota es obligatoria (mínimo 5 caracteres)."
            : `No se pudo registrar: ${body?.error ?? "error"}`,
        );
        return;
      }
      setOpen(false);
      setNote("");
      router.refresh();
    });
  };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn-primary text-sm">
        Registrar contacto
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-5 space-y-4">
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Registrar contacto</h3>

            <label className="block text-sm">
              <span className="font-medium text-slate-700 dark:text-slate-200">Qué hiciste</span>
              <select value={action} onChange={(e) => setAction(e.target.value)} className="input-text mt-1 w-full">
                {ACTIONS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
              </select>
            </label>

            <label className="block text-sm">
              <span className="font-medium text-slate-700 dark:text-slate-200">Canal</span>
              <select value={channel} onChange={(e) => setChannel(e.target.value)} className="input-text mt-1 w-full">
                {CHANNELS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </label>

            <label className="block text-sm">
              <span className="font-medium text-slate-700 dark:text-slate-200">
                Nota (obligatoria) — qué dijo el lead / qué quiere lograr
              </span>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                className="input-text mt-1 w-full"
                placeholder="Ej: Confirmó que asiste. Quiere alemán para trabajar en enfermería en Alemania."
              />
            </label>

            {error && <p className="text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>}

            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)} className="text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 px-3 py-2">
                Cancelar
              </button>
              <button type="button" onClick={submit} disabled={pending} className="btn-primary text-sm">
                {pending ? "Guardando…" : "Guardar contacto"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
