"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

type ErrorReason =
  | "not_found"
  | "expired"
  | "already_used"
  | "invalid_password"
  | "mismatch"
  | "internal";

const ERROR_ES: Record<ErrorReason, string> = {
  not_found:         "El enlace es inválido. Solicita uno nuevo.",
  expired:           "El enlace ha expirado. Solicita uno nuevo.",
  already_used:      "Este enlace ya fue utilizado. Solicita uno nuevo.",
  invalid_password:  "La contraseña debe tener al menos 8 caracteres.",
  mismatch:          "Las contraseñas no coinciden.",
  internal:          "Ocurrió un error. Inténtalo de nuevo.",
};

export function ResetPasswordForm({ token }: { token: string }) {
  const [password,  setPassword]  = useState("");
  const [confirm,   setConfirm]   = useState("");
  const [error,     setError]     = useState<ErrorReason | null>(null);
  const [done,      setDone]      = useState(false);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    setError(null);
    if (password !== confirm) { setError("mismatch"); return; }
    if (password.length < 8)   { setError("invalid_password"); return; }

    startTransition(async () => {
      const res = await fetch("/api/password-reset/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword: password }),
      });

      if (res.ok) {
        setDone(true);
        return;
      }
      const body = await res.json().catch(() => ({}));
      const reason = (body?.error as ErrorReason | undefined) ?? "internal";
      setError(ERROR_ES[reason] ? reason : "internal");
    });
  };

  if (done) {
    return (
      <div className="mt-4 rounded-2xl border border-emerald-200 dark:border-emerald-500/40 bg-emerald-50 dark:bg-emerald-500/10 p-4 text-sm text-emerald-800 dark:text-emerald-200">
        <strong>Contraseña actualizada.</strong>
        <p className="mt-1">
          Ya puedes{" "}
          <Link href="/login" className="underline font-medium">iniciar sesión</Link>{" "}
          con tu nueva contraseña.
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
        <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Nueva contraseña</span>
        <input
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="input-text mt-1"
        />
      </label>

      <label className="block mt-4">
        <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Confírmala</span>
        <input
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="input-text mt-1"
        />
      </label>

      {error && (
        <p className="mt-4 text-sm text-red-600 dark:text-red-400" role="alert">
          {ERROR_ES[error]}
        </p>
      )}

      <button type="submit" className="btn-primary w-full mt-5" disabled={pending}>
        {pending ? "Guardando…" : "Guardar nueva contraseña"}
      </button>
    </form>
  );
}
