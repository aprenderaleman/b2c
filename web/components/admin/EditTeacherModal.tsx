"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { COUNTRY_CODES } from "@/lib/phone";

type Teacher = {
  id:                     string;
  full_name:              string | null;
  email:                  string;
  phone:                  string | null;
  language_preference:    "es" | "de";
  active:                 boolean;
  notifications_opt_out:  boolean;
  bio:                    string | null;
  languages_spoken:       string[];
  specialties:            string[];
  levels_taught:          string[];
  country:                string | null;
  address:                string | null;
  hourly_rate_individual: number | null;
  hourly_rate_group:      number | null;
  currency:               string;
  iban:                   string | null;
  payment_method:         string | null;
  notes:                  string | null;
  scheduledFutureClasses: number;   // para warning al desactivar
};

const LEVELS = ["A0","A1","A2","B1","B2","C1","C2"] as const;
const CURRENCIES = ["EUR","USD","CHF"] as const;

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

export function EditTeacherModal({
  teacher, open, onClose,
}: {
  teacher: Teacher; open: boolean; onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const initial = splitE164(teacher.phone);

  // Datos personales
  const [fullName,    setFullName]    = useState(teacher.full_name ?? "");
  const [email,       setEmail]       = useState(teacher.email);
  const [countryCode, setCountryCode] = useState(initial.cc);
  const [phoneLocal,  setPhoneLocal]  = useState(initial.local);
  const [language,    setLanguage]    = useState<"es"|"de">(teacher.language_preference);
  const [active,      setActive]      = useState(teacher.active);
  const [optOut,      setOptOut]      = useState(teacher.notifications_opt_out);

  // Perfil
  const [bio,        setBio]        = useState(teacher.bio ?? "");
  const [langsCsv,   setLangsCsv]   = useState(teacher.languages_spoken.join(", "));
  const [specsCsv,   setSpecsCsv]   = useState(teacher.specialties.join(", "));
  const [levels,     setLevels]     = useState<string[]>(teacher.levels_taught);
  const [country,    setCountry]    = useState(teacher.country ?? "");
  const [address,    setAddress]    = useState(teacher.address ?? "");

  // Finanzas
  const [rateInd,    setRateInd]    = useState<string>(teacher.hourly_rate_individual?.toString() ?? "");
  const [rateGrp,    setRateGrp]    = useState<string>(teacher.hourly_rate_group?.toString() ?? "");
  const [currency,   setCurrency]   = useState(teacher.currency);
  const [iban,       setIban]       = useState(teacher.iban ?? "");
  const [paymentMet, setPaymentMet] = useState(teacher.payment_method ?? "");

  // Interno
  const [notes,      setNotes]      = useState(teacher.notes ?? "");

  if (!open) return null;

  const toggleLevel = (l: string) =>
    setLevels(levels.includes(l) ? levels.filter(x => x !== l) : [...levels, l]);

  const submit = () => {
    setError(null);

    // Confirmar desactivación si hay clases futuras
    if (teacher.active && !active && teacher.scheduledFutureClasses > 0) {
      if (!confirm(
        `Este profesor tiene ${teacher.scheduledFutureClasses} clase(s) ` +
        `agendada(s) en el futuro. Si lo desactivas, dejará de poder entrar al ` +
        `aula y aparecer en el pool de trials, pero las clases quedarán huérfanas. ` +
        `¿Continuar?`,
      )) return;
    }

    const phoneRaw = phoneLocal.trim() ? `${countryCode} ${phoneLocal.trim()}` : null;
    startTransition(async () => {
      const body: Record<string, unknown> = {
        full_name:           fullName.trim(),
        email:               email.trim(),
        language_preference: language,
        active,
        notifications_opt_out: optOut,
        bio:                 bio.trim() || null,
        languages_spoken:    langsCsv.split(",").map(s => s.trim()).filter(Boolean),
        specialties:         specsCsv.split(",").map(s => s.trim()).filter(Boolean),
        levels_taught:       levels,
        country:             country.trim() || null,
        address:             address.trim() || null,
        currency,
        iban:                iban.trim() || null,
        payment_method:      paymentMet.trim() || null,
        notes:               notes.trim() || null,
      };
      if (phoneRaw) { body.phone = phoneRaw; body.phone_country = countryCode; }
      else if (phoneLocal.trim() === "" && teacher.phone) { body.phone = null; }
      if (rateInd.trim() !== "") body.hourly_rate_individual = Number(rateInd);
      if (rateGrp.trim() !== "") body.hourly_rate_group      = Number(rateGrp);

      const res = await fetch(`/api/admin/teachers/${teacher.id}/update`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.error === "email_in_use") setError("Ese email ya pertenece a otro usuario.");
        else if (data.error === "phone_invalid") setError("Teléfono inválido. Solo dígitos en el campo del número.");
        else setError(data.message || data.error || "Error guardando los cambios.");
        return;
      }
      router.refresh();
      onClose();
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="w-full max-w-2xl rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl my-8">
        <header className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800 sticky top-0 bg-white dark:bg-slate-900 z-10">
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-50">Editar profesor</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 text-2xl leading-none" aria-label="Cerrar">×</button>
        </header>

        <div className="px-6 py-5 space-y-6">

          <Section title="Datos personales">
            <Field label="Nombre completo">
              <input type="text" value={fullName} onChange={e=>setFullName(e.target.value)} className="input-text" />
            </Field>
            <Field label="Email">
              <input type="email" value={email} onChange={e=>setEmail(e.target.value)} className="input-text" />
            </Field>
            <Field label="Teléfono / WhatsApp">
              <div className="flex gap-2">
                <select value={countryCode} onChange={e=>setCountryCode(e.target.value)} className="input-text w-32" aria-label="País">
                  {COUNTRY_CODES.map(c => <option key={c.code} value={c.code}>{c.flag} {c.code}</option>)}
                </select>
                <input type="tel" inputMode="tel" value={phoneLocal} onChange={e=>setPhoneLocal(e.target.value)} className="input-text flex-1" placeholder="641 051 234" />
              </div>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Idioma de la app">
                <select value={language} onChange={e=>setLanguage(e.target.value as "es"|"de")} className="input-text">
                  <option value="es">Español</option><option value="de">Deutsch</option>
                </select>
              </Field>
              <div className="flex flex-col gap-2 pt-5">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={active} onChange={e=>setActive(e.target.checked)} />
                  Cuenta activa
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={optOut} onChange={e=>setOptOut(e.target.checked)} />
                  Silenciar emails
                </label>
              </div>
            </div>
          </Section>

          <Section title="Perfil académico">
            <Field label="Bio (descripción pública)">
              <textarea value={bio} onChange={e=>setBio(e.target.value)} className="input-text min-h-[80px]" placeholder="Profesora bilingüe con 10 años de experiencia…" />
            </Field>
            <Field label="Idiomas que habla (separados por coma)">
              <input type="text" value={langsCsv} onChange={e=>setLangsCsv(e.target.value)} className="input-text" placeholder="de, es, en" />
            </Field>
            <Field label="Especialidades (separadas por coma)">
              <input type="text" value={specsCsv} onChange={e=>setSpecsCsv(e.target.value)} className="input-text" placeholder="examen telc, business, conversación" />
            </Field>
            <Field label="Niveles que enseña">
              <div className="flex gap-1.5 flex-wrap">
                {LEVELS.map(l => (
                  <button key={l} type="button" onClick={()=>toggleLevel(l)} className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors ${
                    levels.includes(l)
                      ? "border-brand-500 bg-brand-100 dark:bg-brand-500/20 text-brand-700 dark:text-brand-300"
                      : "border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-brand-400"
                  }`}>{l}</button>
                ))}
              </div>
            </Field>
          </Section>

          <Section title="Finanzas">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Tarifa individual (€/h)">
                <input type="number" min={0} step={0.5} value={rateInd} onChange={e=>setRateInd(e.target.value)} className="input-text" />
              </Field>
              <Field label="Tarifa grupal (€/h)">
                <input type="number" min={0} step={0.5} value={rateGrp} onChange={e=>setRateGrp(e.target.value)} className="input-text" />
              </Field>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Cambiar las tarifas solo afecta a las clases facturadas DESPUÉS de guardar. Las pasadas conservan la tarifa con la que se cerraron.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Moneda">
                <select value={currency} onChange={e=>setCurrency(e.target.value)} className="input-text">
                  {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
              <Field label="Método de pago">
                <input type="text" value={paymentMet} onChange={e=>setPaymentMet(e.target.value)} className="input-text" placeholder="SEPA, Wise, …" />
              </Field>
            </div>
            <Field label="IBAN">
              <input type="text" value={iban} onChange={e=>setIban(e.target.value)} className="input-text font-mono" placeholder="ES00 0000 0000 0000 0000 0000" />
            </Field>
          </Section>

          <Section title="Interno (no lo ve el profesor)">
            <div className="grid grid-cols-2 gap-3">
              <Field label="País">
                <input type="text" value={country} onChange={e=>setCountry(e.target.value)} className="input-text" placeholder="España" />
              </Field>
              <Field label="Dirección">
                <input type="text" value={address} onChange={e=>setAddress(e.target.value)} className="input-text" placeholder="Calle…" />
              </Field>
            </div>
            <Field label="Notas internas">
              <textarea value={notes} onChange={e=>setNotes(e.target.value)} className="input-text min-h-[60px]" placeholder="Por qué subimos su tarifa, qué le prometimos, etc." />
            </Field>
          </Section>

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        </div>

        <footer className="flex items-center justify-end gap-2 px-6 py-4 border-t border-slate-200 dark:border-slate-800 sticky bottom-0 bg-white dark:bg-slate-900">
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800 pb-1">
        {title}
      </h3>
      <div className="space-y-3">{children}</div>
    </section>
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
