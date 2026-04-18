"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function RecordPaymentButton({
  studentId, currentLevel: _currentLevel,
}: { studentId: string; currentLevel?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [amount,    setAmount]    = useState<number>(0);
  const [type,      setType]      = useState<"single_class" | "package" | "subscription_payment" | "other">("package");
  const [classes,   setClasses]   = useState<number>(0);
  const [note,      setNote]      = useState("");
  const [error,     setError]     = useState<string | null>(null);

  const submit = () => {
    if (amount <= 0) { setError("Introduce un importe."); return; }
    setError(null);
    startTransition(async () => {
      const res = await fetch("/api/admin/finanzas/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentId,
          amountEuros:  amount,
          currency:     "EUR",
          type,
          classesAdded: type === "subscription_payment" ? 0 : classes,
          note:         note.trim() || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.message ?? "Error al registrar el pago.");
        return;
      }
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs font-medium rounded-full border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10 px-3 py-1 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-500/20"
      >
        + Registrar pago
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <div className="w-full max-w-md rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl">
            <header className="px-6 py-5 border-b border-slate-200 dark:border-slate-800">
              <h2 className="text-lg font-bold text-slate-900 dark:text-slate-50">Registrar pago</h2>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Acredita un pago manual (transferencia, Bizum, cash…). Queda como <strong>pagado</strong>.
              </p>
            </header>
            <div className="p-6 space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <Field label="Importe (€)">
                  <input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(Number(e.target.value))} className="input-text" autoFocus />
                </Field>
                <Field label="Tipo">
                  <select value={type} onChange={(e) => setType(e.target.value as typeof type)} className="input-text">
                    <option value="single_class">Clase suelta</option>
                    <option value="package">Paquete</option>
                    <option value="subscription_payment">Suscripción</option>
                    <option value="other">Otro</option>
                  </select>
                </Field>
              </div>
              {type !== "subscription_payment" && (
                <Field label="Clases a añadir al saldo">
                  <input type="number" min={0} max={500} value={classes} onChange={(e) => setClasses(Number(e.target.value))} className="input-text" />
                </Field>
              )}
              <Field label="Nota (opcional)">
                <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="input-text" />
              </Field>
              {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
            </div>
            <footer className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-3">
              <button type="button" className="btn-secondary" onClick={() => setOpen(false)} disabled={pending}>Cancelar</button>
              <button type="button" className="btn-primary" onClick={submit} disabled={pending}>
                {pending ? "Guardando…" : "Guardar"}
              </button>
            </footer>
          </div>
        </div>
      )}
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
