"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { COUNTRY_CODES } from "@/lib/phone";

/**
 * Editor manual de un estudiante. Hermano de EditLeadModal pero abre los
 * campos académicos del students table además de los datos personales
 * de users. NO toca pack — eso tiene su propio modal (EditPackButton).
 */

type Student = {
  id:                    string;
  full_name:             string | null;
  email:                 string;
  phone:                 string | null;
  language_preference:   "es" | "de";
  current_level:         string;
  goal:                  string | null;
  subscription_type:     string;
  subscription_status:   string;
  schule_access:         boolean;
  hans_access:           boolean;
};

const LEVELS = ["A0","A1","A2","B1","B2","C1","C2"] as const;
const SUB_TYPES = ["single_classes","package","monthly_subscription","combined"] as const;
const SUB_STATUS = ["active","paused","cancelled","expired"] as const;

function splitE164(phone: string | null): { cc: string; local: string } {
  if (!phone) return { cc: "+49", local: "" };
  const digits = phone.replace(/[^\d]/g, "");
  const sorted = [...COUNTRY_CODES].sort((a, b) => b.code.length - a.code.length);
  for (const c of sorted) {
    const cc = c.code.replace("+", "");
    if (digits.startsWith(cc)) return { cc: c.code, local: digits.slice(cc.length) };
  }
  return { cc: "+49", local: digits };
}

export function EditStudentModal({
  student, open, onClose,
}: {
  student: Student;
  open:    boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const initial = splitE164(student.phone);

  const [fullName,    setFullName]    = useState(student.full_name ?? "");
  const [email,       setEmail]       = useState(student.email);
  const [countryCode, setCountryCode] = useState(initial.cc);
  const [phoneLocal,  setPhoneLocal]  = useState(initial.local);
  const [language,    setLanguage]    = useState<"es"|"de">(student.language_preference);
  const [level,       setLevel]       = useState(student.current_level);
  const [goal,        setGoal]        = useState(student.goal ?? "");
  const [subType,     setSubType]     = useState(student.subscription_type);
  const [subStatus,   setSubStatus]   = useState(student.subscription_status);
  const [schule,      setSchule]      = useState(student.schule_access);
  const [hans,        setHans]        = useState(student.hans_access);

  if (!open) return null;

  const submit = () => {
    setError(null);
    const phoneRaw = phoneLocal.trim() ? `${countryCode} ${phoneLocal.trim()}` : null;
    startTransition(async () => {
      const body: Record<string, unknown> = {
        full_name: fullName.trim(),
        email:     email.trim(),
        language_preference: language,
        current_level:       level,
        goal:                goal.trim() || null,
        subscription_type:   subType,
        subscription_status: subStatus,
        schule_access:       schule,
        hans_access:         hans,
      };
      if (phoneRaw) { body.phone = phoneRaw; body.phone_country = countryCode; }
      else if (phoneLocal.trim() === "" && student.phone) { body.phone = null; }

      const res = await fetch(`/api/admin/students/${student.id}/update`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.error === "phone_invalid") setError("Teléfono inválido. Solo dígitos en el campo del número.");
        else setError(data.message || data.error || "Error guardando los cambios.");
        return;
      }
      router.refresh();
      onClose();
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="w-full max-w-lg rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl my-8">
        <header className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-50">Editar estudiante</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 text-2xl leading-none" aria-label="Cerrar">×</button>
        </header>

        <div className="px-6 py-5 space-y-4">
          <Field label="Nombre completo">
            <input type="text" value={fullName} onChange={e=>setFullName(e.target.value)} className="input-text" />
          </Field>
          <Field label="Email">
            <input type="email" value={email} onChange={e=>setEmail(e.target.value)} className="input-text" />
          </Field>
          <Field label="Teléfono / WhatsApp (opcional)">
            <div className="flex gap-2">
              <select value={countryCode} onChange={e=>setCountryCode(e.target.value)} className="input-text w-32" aria-label="País">
                {COUNTRY_CODES.map(c => <option key={c.code} value={c.code}>{c.flag} {c.code}</option>)}
              </select>
              <input type="tel" inputMode="tel" value={phoneLocal} onChange={e=>setPhoneLocal(e.target.value)} className="input-text flex-1" placeholder="641 051 234" />
            </div>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Solo dígitos en el campo. Actual: <span className="font-mono">{student.phone || "—"}</span></p>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Idioma de la app">
              <select value={language} onChange={e=>setLanguage(e.target.value as "es"|"de")} className="input-text">
                <option value="es">Español</option><option value="de">Deutsch</option>
              </select>
            </Field>
            <Field label="Nivel actual">
              <select value={level} onChange={e=>setLevel(e.target.value)} className="input-text">
                {LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </Field>
          </div>

          <Field label="Meta / objetivo">
            <input type="text" value={goal} onChange={e=>setGoal(e.target.value)} className="input-text" placeholder="trabajo, estudios, viaje…" />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Tipo de suscripción">
              <select value={subType} onChange={e=>setSubType(e.target.value)} className="input-text">
                {SUB_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g," ")}</option>)}
              </select>
            </Field>
            <Field label="Estado">
              <select value={subStatus} onChange={e=>setSubStatus(e.target.value)} className="input-text">
                {SUB_STATUS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={schule} onChange={e=>setSchule(e.target.checked)} />
              Acceso a Schule
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={hans} onChange={e=>setHans(e.target.checked)} />
              Acceso a Hans
            </label>
          </div>

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        </div>

        <footer className="flex items-center justify-end gap-2 px-6 py-4 border-t border-slate-200 dark:border-slate-800">
          <button type="button" onClick={onClose} className="text-sm font-medium px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800">
            Cancelar
          </button>
          <button type="button" onClick={submit} disabled={pending} className="text-sm font-semibold px-4 py-2 rounded-xl bg-brand-500 hover:bg-brand-600 text-white disabled:opacity-50">
            {pending ? "Guardando…" : "Guardar cambios"}
          </button>
        </footer>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 uppercase tracking-wide">{label}</span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}
