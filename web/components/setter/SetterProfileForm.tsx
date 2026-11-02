"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

/** Datos de pago y contacto del setter — editables por él mismo. */
export function SetterProfileForm({
  initialIban,
  initialPhone,
}: {
  initialIban: string | null;
  initialPhone: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [iban, setIban] = useState(initialIban ?? "");
  const [phone, setPhone] = useState(initialPhone ?? "");

  const submit = () => {
    setError(null);
    setOkMsg(null);
    start(async () => {
      const res = await fetch("/api/setter/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ iban, phone }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error === "iban_invalido"
          ? "Ese IBAN no parece válido — revisa el país y los dígitos (ej: DE89 3704 0044 0532 0130 00)."
          : "No se pudo guardar. Revisa los datos.");
        return;
      }
      setOkMsg("✅ Guardado. Gelfis ya puede ver tus datos de pago.");
      router.refresh();
    });
  };

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); submit(); }}
      className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4 max-w-xl"
    >
      <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Datos de pago y contacto</h2>

      <label className="block text-sm">
        <span className="font-medium text-slate-700 dark:text-slate-200">IBAN (para recibir tu pago)</span>
        <input
          value={iban}
          onChange={(e) => setIban(e.target.value)}
          placeholder="DE89 3704 0044 0532 0130 00"
          className="input-text mt-1 w-full font-mono"
          autoComplete="off"
        />
      </label>

      <label className="block text-sm">
        <span className="font-medium text-slate-700 dark:text-slate-200">Teléfono</span>
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+57 300 123 4567"
          className="input-text mt-1 w-full"
          autoComplete="off"
        />
      </label>

      {error && <p className="text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>}
      {okMsg && <p className="text-sm text-emerald-700 dark:text-emerald-300">{okMsg}</p>}

      <button type="submit" disabled={pending} className="btn-primary text-sm">
        {pending ? "Guardando…" : "Guardar"}
      </button>
    </form>
  );
}
