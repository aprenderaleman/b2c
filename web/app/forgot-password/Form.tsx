"use client";

import { useState, useTransition } from "react";

export function ForgotPasswordForm() {
  const [email, setEmail]   = useState("");
  const [sent,  setSent]    = useState(false);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    startTransition(async () => {
      // The endpoint always returns 200 — we optimistically show the
      // "check your email" confirmation no matter what, to avoid leaking
      // whether the account exists.
      await fetch("/api/password-reset/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      }).catch(() => { /* swallow */ });
      setSent(true);
    });
  };

  if (sent) {
    return (
      <div className="mt-5 rounded-2xl border border-emerald-200 dark:border-emerald-500/40 bg-emerald-50 dark:bg-emerald-500/10 p-4 text-sm text-emerald-800 dark:text-emerald-200">
        <strong>Revisa tu correo.</strong>
        <p className="mt-1">
          Si hay una cuenta asociada a <code className="font-mono text-xs">{email}</code>,
          te acabamos de enviar un enlace para restablecer la contraseña. El enlace expira en 1 hora.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); submit(); }}
      className="mt-4"
    >
      <label className="block">
        <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Correo electrónico</span>
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="input-text mt-1"
        />
      </label>

      <button type="submit" className="btn-primary w-full mt-5" disabled={pending}>
        {pending ? "Enviando…" : "Enviarme el enlace"}
      </button>
    </form>
  );
}
