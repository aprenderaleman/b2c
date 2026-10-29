"use client";

import { useState } from "react";

/**
 * Tarjeta "Cambiar contraseña" del perfil (estudiantes y profes).
 * POST /api/profile/change-password — exige la contraseña actual.
 */
export function ChangePasswordCard() {
  const [current, setCurrent] = useState("");
  const [next, setNext]       = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy]       = useState(false);
  const [msg, setMsg]         = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (next.length < 8) { setMsg({ ok: false, text: "La nueva contraseña debe tener al menos 8 caracteres." }); return; }
    if (next !== confirm) { setMsg({ ok: false, text: "La confirmación no coincide con la nueva contraseña." }); return; }
    setBusy(true);
    try {
      const res  = await fetch("/api/profile/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      const data = await res.json();
      if (res.ok) {
        setMsg({ ok: true, text: "✅ Contraseña cambiada. Úsala la próxima vez que inicies sesión." });
        setCurrent(""); setNext(""); setConfirm("");
      } else {
        setMsg({ ok: false, text: data.message ?? (data.error === "wrong_password" ? "La contraseña actual es incorrecta." : "No se pudo cambiar — inténtalo de nuevo.") });
      }
    } catch {
      setMsg({ ok: false, text: "Error de red — inténtalo de nuevo." });
    } finally {
      setBusy(false);
    }
  }

  const input = "w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100";

  return (
    <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 max-w-md">
      <h2 className="text-base font-semibold text-slate-900 dark:text-slate-50">🔑 Cambiar contraseña</h2>
      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 mb-4">
        Mínimo 8 caracteres. Si no recuerdas la actual, usa «¿Olvidaste tu contraseña?» en la pantalla de inicio de sesión.
      </p>
      <form onSubmit={submit} className="space-y-3">
        <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
          Contraseña actual
          <input type="password" autoComplete="current-password" required value={current} onChange={e => setCurrent(e.target.value)} className={`mt-1 ${input}`} />
        </label>
        <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
          Nueva contraseña
          <input type="password" autoComplete="new-password" required minLength={8} value={next} onChange={e => setNext(e.target.value)} className={`mt-1 ${input}`} />
        </label>
        <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
          Repite la nueva contraseña
          <input type="password" autoComplete="new-password" required minLength={8} value={confirm} onChange={e => setConfirm(e.target.value)} className={`mt-1 ${input}`} />
        </label>
        {msg && (
          <p className={`text-xs ${msg.ok ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>{msg.text}</p>
        )}
        <button type="submit" disabled={busy} className="btn-primary text-sm disabled:opacity-50">
          {busy ? "Guardando…" : "Guardar contraseña"}
        </button>
      </form>
    </section>
  );
}
