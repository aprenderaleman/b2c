"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { COUNTRY_CODES } from "@/lib/phone";

/**
 * Manual editor for a lead's core fields. Most common use: fixing a
 * mis-typed WhatsApp number (the public funnel can't always catch a
 * lead who pastes the country prefix into BOTH the country picker
 * AND the phone input — "+34" + "34641…" → "+3434641…").
 *
 * The phone field shows the country code separately so the admin can
 * reset it without juggling string parsing — the API normalises the
 * combination server-side via lib/phone.
 */

type Lead = {
  id:    string;
  name:  string;
  email: string | null;
  whatsapp_normalized: string | null;
  language:     "es" | "de";
  german_level: string | null;
  goal:         string | null;
};

const LEVELS = ["A0", "A1-A2", "B1", "B2+"] as const;
const GOALS  = ["work", "visa", "studies", "exam", "travel", "already_in_dach"] as const;

type Props = {
  lead:    Lead;
  open:    boolean;
  onClose: () => void;
};

/** Best-effort split of a stored E.164 number into (cc, local) so the
 *  form can pre-fill both fields. Falls back to (+49, full) if we
 *  can't recognise the prefix. */
function splitE164(phone: string | null): { cc: string; local: string } {
  if (!phone) return { cc: "+49", local: "" };
  const digits = phone.replace(/[^\d]/g, "");
  // Try the longest prefix in the dropdown that matches.
  const sorted = [...COUNTRY_CODES].sort((a, b) => b.code.length - a.code.length);
  for (const c of sorted) {
    const cc = c.code.replace("+", "");
    if (digits.startsWith(cc)) return { cc: c.code, local: digits.slice(cc.length) };
  }
  return { cc: "+49", local: digits };
}

export function EditLeadModal({ lead, open, onClose }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const initial = splitE164(lead.whatsapp_normalized);

  const [name,         setName]         = useState(lead.name ?? "");
  const [email,        setEmail]        = useState(lead.email ?? "");
  const [countryCode,  setCountryCode]  = useState(initial.cc);
  const [phoneLocal,   setPhoneLocal]   = useState(initial.local);
  const [language,     setLanguage]     = useState<"es" | "de">(lead.language);
  const [germanLevel,  setGermanLevel]  = useState<string>(lead.german_level ?? "A0");
  const [goal,         setGoal]         = useState<string>(lead.goal ?? "");

  if (!open) return null;

  const submit = () => {
    setError(null);

    // Build the full phone the same way the funnel does: country code
    // + space + local digits. The server normalises and validates.
    const phoneRaw = phoneLocal.trim()
      ? `${countryCode} ${phoneLocal.trim()}`
      : null;

    startTransition(async () => {
      const body: Record<string, unknown> = {
        name: name.trim() || null,
        email: email.trim() || null,
        language,
        german_level: germanLevel || null,
        goal:         goal || null,
      };
      if (phoneRaw) {
        body.whatsapp_normalized = phoneRaw;
        body.whatsapp_country    = countryCode;
      }

      const res = await fetch(`/api/admin/leads/${lead.id}/update`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (data.error === "phone_invalid") {
          setError("El WhatsApp no es válido. Revisa que sea solo dígitos en el campo del número.");
          return;
        }
        if (data.error === "phone_already_used_by_another_lead") {
          setError("Ese número ya pertenece a otro lead. Verifica y borra el duplicado primero.");
          return;
        }
        setError(data.message || data.error || "Error guardando los cambios.");
        return;
      }

      // Re-fetch the page so the admin sees the updated values.
      router.refresh();
      onClose();
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="w-full max-w-lg rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl my-8">
        <header className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-50">Editar datos del lead</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-2xl leading-none"
            aria-label="Cerrar"
          >×</button>
        </header>

        <div className="px-6 py-5 space-y-4">
          <Field label="Nombre">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input-text"
              placeholder="Nombre completo"
            />
          </Field>

          <Field label="Email">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input-text"
              placeholder="lead@email.com"
            />
          </Field>

          <Field label="WhatsApp">
            <div className="flex gap-2">
              <select
                value={countryCode}
                onChange={(e) => setCountryCode(e.target.value)}
                className="input-text w-32"
                aria-label="Código de país"
              >
                {COUNTRY_CODES.map(c => (
                  <option key={c.code} value={c.code}>{c.flag} {c.code}</option>
                ))}
              </select>
              <input
                type="tel"
                inputMode="tel"
                value={phoneLocal}
                onChange={(e) => setPhoneLocal(e.target.value)}
                className="input-text flex-1"
                placeholder="641 051 234"
              />
            </div>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Pon SOLO los dígitos del número en el campo de la derecha — el prefijo se selecciona aparte.
              Actual: <span className="font-mono">{lead.whatsapp_normalized || "—"}</span>
            </p>
          </Field>

          <Field label="Idioma">
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value as "es" | "de")}
              className="input-text"
            >
              <option value="es">Español</option>
              <option value="de">Deutsch</option>
            </select>
          </Field>

          <Field label="Nivel de alemán">
            <select
              value={germanLevel}
              onChange={(e) => setGermanLevel(e.target.value)}
              className="input-text"
            >
              {LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </Field>

          <Field label="Objetivo">
            <select
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              className="input-text"
            >
              <option value="">—</option>
              {GOALS.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          </Field>

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 px-6 py-4 border-t border-slate-200 dark:border-slate-800">
          <button type="button" onClick={onClose} className="btn-secondary text-sm" disabled={pending}>
            Cancelar
          </button>
          <button type="button" onClick={submit} className="btn-primary text-sm" disabled={pending}>
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
      <span className="block text-xs font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wider mb-1">
        {label}
      </span>
      {children}
    </label>
  );
}
