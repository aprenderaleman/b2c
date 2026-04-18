"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function CreateTeacherForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [tempPassword, setTempPassword] = useState<string | null>(null);

  const [email,    setEmail]    = useState("");
  const [fullName, setFullName] = useState("");
  const [phone,    setPhone]    = useState("");
  const [language, setLanguage] = useState<"es" | "de">("de");

  const [bio,           setBio]           = useState("");
  const [languagesText, setLanguagesText] = useState("de, es");
  const [specsText,     setSpecsText]     = useState("A1, A2, B1, B2");
  const [hourlyRate,    setHourlyRate]    = useState<number>(25);
  const [currency,      setCurrency]      = useState<"EUR" | "USD" | "CHF">("EUR");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [notes,         setNotes]         = useState("");

  const submit = () => {
    setError(null);
    setTempPassword(null);
    startTransition(async () => {
      const payload = {
        email,
        fullName,
        phone: phone.trim() || null,
        language,
        bio: bio.trim() || null,
        languagesSpoken: toArray(languagesText),
        specialties: toArray(specsText),
        hourlyRate,
        currency,
        paymentMethod: paymentMethod.trim() || null,
        notes: notes.trim() || null,
      };
      const res = await fetch("/api/admin/teachers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.message ?? body?.error ?? "Error al crear el profesor.");
        return;
      }
      const body = await res.json().catch(() => ({}));
      if (body?.emailSent === false && body?.tempPassword) {
        // Email send failed — surface the password so admin can relay.
        setTempPassword(body.tempPassword);
        return;
      }
      router.push("/admin/profesores");
      router.refresh();
    });
  };

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); submit(); }}
      className="space-y-4 max-w-2xl"
    >
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Nombre completo">
          <input required value={fullName} onChange={(e) => setFullName(e.target.value)} className="input-text" />
        </Field>
        <Field label="Correo electrónico">
          <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="input-text" />
        </Field>
        <Field label="WhatsApp (opcional)">
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+49…" className="input-text" />
        </Field>
        <Field label="Idioma del profesor">
          <select value={language} onChange={(e) => setLanguage(e.target.value as "es" | "de")} className="input-text">
            <option value="de">Alemán</option>
            <option value="es">Español</option>
          </select>
        </Field>
      </div>

      <Field label="Biografía (opcional)">
        <textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={3} className="input-text" placeholder="Breve descripción mostrada a los estudiantes." />
      </Field>

      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Idiomas que habla" hint="Separados por coma (p. ej. de, es, en)">
          <input value={languagesText} onChange={(e) => setLanguagesText(e.target.value)} className="input-text" />
        </Field>
        <Field label="Especialidades" hint="Separadas por coma (p. ej. A1, B2, TELC, Goethe)">
          <input value={specsText} onChange={(e) => setSpecsText(e.target.value)} className="input-text" />
        </Field>
      </div>

      <fieldset className="rounded-2xl border border-slate-200 dark:border-slate-700 p-4 space-y-3">
        <legend className="px-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Datos económicos (no visibles al profesor)
        </legend>
        <div className="grid sm:grid-cols-3 gap-4">
          <Field label="Tarifa por hora">
            <input type="number" min={0} step="0.5" value={hourlyRate} onChange={(e) => setHourlyRate(Number(e.target.value))} className="input-text" />
          </Field>
          <Field label="Moneda">
            <select value={currency} onChange={(e) => setCurrency(e.target.value as "EUR" | "USD" | "CHF")} className="input-text">
              <option value="EUR">EUR</option>
              <option value="USD">USD</option>
              <option value="CHF">CHF</option>
            </select>
          </Field>
          <Field label="Método de pago">
            <input value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className="input-text" placeholder="IBAN, PayPal, …" />
          </Field>
        </div>
        <Field label="Notas (sólo admin)">
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="input-text" />
        </Field>
      </fieldset>

      {error && <p className="text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>}

      {tempPassword && (
        <div className="rounded-2xl border border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-500/10 p-4 text-sm text-amber-800 dark:text-amber-200">
          <strong>Profesor creado</strong>, pero el email de bienvenida NO se pudo enviar. Pásale estas credenciales manualmente:
          <br />
          <code className="mt-2 inline-block bg-white dark:bg-slate-900 px-2 py-1 rounded font-mono text-xs">{email}</code>
          <span> / </span>
          <code className="bg-white dark:bg-slate-900 px-2 py-1 rounded font-mono text-xs">{tempPassword}</code>
        </div>
      )}

      <div className="flex items-center gap-3">
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? "Creando…" : "Crear profesor y enviar acceso"}
        </button>
      </div>
    </form>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">{hint}</span>}
    </label>
  );
}

function toArray(s: string): string[] {
  return s.split(",").map(x => x.trim()).filter(Boolean);
}
