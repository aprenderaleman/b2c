"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function CreateAdminForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [tempPassword, setTempPassword] = useState<string | null>(null);

  const [email,    setEmail]    = useState("");
  const [fullName, setFullName] = useState("");
  const [phone,    setPhone]    = useState("");
  const [language, setLanguage] = useState<"es" | "de">("es");

  const submit = () => {
    setError(null);
    setTempPassword(null);
    startTransition(async () => {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email, fullName, phone: phone.trim() || null, language,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (res.status === 403) {
          setError("Sólo el superadmin puede crear otros admins.");
          return;
        }
        setError(body?.message ?? body?.error ?? "Error al crear el admin.");
        return;
      }
      const body = await res.json().catch(() => ({}));
      if (body?.emailSent === false && body?.tempPassword) {
        setTempPassword(body.tempPassword);
        return;
      }
      router.push("/admin");
      router.refresh();
    });
  };

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); submit(); }}
      className="space-y-4 max-w-xl"
    >
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Nombre completo">
          <input required value={fullName} onChange={(e) => setFullName(e.target.value)} className="input-text" />
        </Field>
        <Field label="Correo electrónico">
          <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="input-text" />
        </Field>
        <Field label="Teléfono (opcional)">
          <input value={phone} onChange={(e) => setPhone(e.target.value)} className="input-text" />
        </Field>
        <Field label="Idioma">
          <select value={language} onChange={(e) => setLanguage(e.target.value as "es" | "de")} className="input-text">
            <option value="es">Español</option>
            <option value="de">Alemán</option>
          </select>
        </Field>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>}

      {tempPassword && (
        <div className="rounded-2xl border border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-500/10 p-4 text-sm text-amber-800 dark:text-amber-200">
          <strong>Admin creado</strong>, pero el email de bienvenida NO se pudo enviar. Pásale estas credenciales manualmente:
          <br />
          <code className="mt-2 inline-block bg-white dark:bg-slate-900 px-2 py-1 rounded font-mono text-xs">{email}</code>
          <span> / </span>
          <code className="bg-white dark:bg-slate-900 px-2 py-1 rounded font-mono text-xs">{tempPassword}</code>
        </div>
      )}

      <button type="submit" className="btn-primary" disabled={pending}>
        {pending ? "Creando…" : "Crear admin y enviar acceso"}
      </button>
    </form>
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
