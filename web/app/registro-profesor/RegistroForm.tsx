"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const COUNTRIES = [
  { code: "ES", name: "España" },
  { code: "DE", name: "Alemania" },
  { code: "AT", name: "Austria" },
  { code: "CH", name: "Suiza" },
  { code: "AR", name: "Argentina" },
  { code: "MX", name: "México" },
  { code: "CO", name: "Colombia" },
  { code: "CL", name: "Chile" },
  { code: "PE", name: "Perú" },
  { code: "UY", name: "Uruguay" },
  { code: "VE", name: "Venezuela" },
  { code: "EC", name: "Ecuador" },
  { code: "BR", name: "Brasil" },
  { code: "PT", name: "Portugal" },
  { code: "FR", name: "Francia" },
  { code: "IT", name: "Italia" },
  { code: "GB", name: "Reino Unido" },
  { code: "US", name: "Estados Unidos" },
  { code: "XX", name: "Otro" },
];

const LEVELS = ["A0", "A1", "A2", "B1", "B2", "C1", "C2"] as const;

const TIMEZONES = [
  { value: "Europe/Madrid",        label: "España (Madrid)" },
  { value: "Atlantic/Canary",      label: "España (Canarias)" },
  { value: "Europe/Berlin",        label: "Alemania / Austria / Suiza" },
  { value: "Europe/Lisbon",        label: "Portugal" },
  { value: "Europe/London",        label: "Reino Unido" },
  { value: "America/Mexico_City",  label: "México (CDMX)" },
  { value: "America/Bogota",       label: "Colombia / Perú / Ecuador" },
  { value: "America/Caracas",      label: "Venezuela" },
  { value: "America/Santiago",     label: "Chile" },
  { value: "America/Argentina/Buenos_Aires", label: "Argentina / Uruguay" },
  { value: "America/Sao_Paulo",    label: "Brasil (São Paulo)" },
  { value: "America/New_York",     label: "EE.UU. (Este)" },
  { value: "America/Chicago",      label: "EE.UU. (Centro)" },
  { value: "America/Los_Angeles",  label: "EE.UU. (Pacífico)" },
];

const FRANJAS = [
  { value: "mananas", label: "🌅 Mañanas", hint: "8:00–13:00" },
  { value: "tardes",  label: "☀️ Tardes",  hint: "13:00–18:00" },
  { value: "noches",  label: "🌙 Noches",  hint: "18:00–22:00" },
  { value: "findes",  label: "📅 Fines de semana", hint: "sáb y dom" },
];

const RANGO_LABEL: Record<string, string> = {
  starter: "Starter",
  pro:     "Pro",
  elite:   "Elite",
  master:  "Master",
};

const MAX_PHOTO_BYTES = 2 * 1024 * 1024;   // 2 MB

type FormState = {
  name:         string;
  countryCode:  string;     // "+34"
  phone:        string;
  address:      string;
  country:      string;     // ISO-2
  languages:    string;     // libre, comma-separated
  specialties:  string;     // libre, comma-separated
  levels:       string[];   // ['A1', 'A2', ...]
  timezone:     string;
  franjas:      string[];   // ['mananas', 'tardes', ...]
  iban:         string;
  gdpr:         boolean;
  agreement:    boolean;
};

export function RegistroForm({
  code, invEmail, invName, rateIndividual, rango, comisionPct,
}: {
  code:           string;
  invEmail:       string;
  invName:        string;
  rateIndividual: number | null;
  rango:          string;
  comisionPct:    number | null;
}) {
  const [form, setForm] = useState<FormState>({
    name: invName,
    countryCode: "+34", phone: "",
    address: "", country: "ES",
    languages: "Alemán nativo, Español",
    specialties: "",
    levels: [],
    timezone: "Europe/Madrid",
    franjas: [],
    iban: "",
    gdpr: false, agreement: false,
  });
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  const [photoErr, setPhotoErr]         = useState<string | null>(null);
  const [submitting, setSubmitting]     = useState(false);
  const [err, setErr]                   = useState<string | null>(null);
  const [done, setDone]                 = useState(false);

  // Preseleccionar la zona horaria del navegador si está en la lista.
  useEffect(() => {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (TIMEZONES.some(t => t.value === tz)) {
        setForm(f => ({ ...f, timezone: tz }));
      }
    } catch { /* keep default */ }
  }, []);

  function toggle<K extends keyof FormState>(key: K, val: FormState[K]) {
    setForm(f => ({ ...f, [key]: val }));
  }

  function toggleLevel(l: string) {
    setForm(f => ({
      ...f,
      levels: f.levels.includes(l) ? f.levels.filter(x => x !== l) : [...f.levels, l],
    }));
  }

  function toggleFranja(v: string) {
    setForm(f => ({
      ...f,
      franjas: f.franjas.includes(v) ? f.franjas.filter(x => x !== v) : [...f.franjas, v],
    }));
  }

  function onPhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    setPhotoErr(null);
    const file = e.target.files?.[0];
    if (!file) { setPhotoDataUrl(null); return; }
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      setPhotoErr("Formato no válido. Usa JPG, PNG o WebP.");
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      setPhotoErr("La foto supera los 2 MB. Usa una más ligera.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setPhotoDataUrl(reader.result as string);
    reader.readAsDataURL(file);
  }

  const phoneDigits = form.phone.replace(/\D/g, "");
  const canSubmit =
    form.name.trim().length >= 2 &&
    phoneDigits.length >= 6 &&
    form.address.trim().length >= 4 &&
    form.country.length === 2 &&
    form.languages.trim().length >= 2 &&
    form.specialties.trim().length >= 2 &&
    form.levels.length >= 1 &&
    form.timezone.length > 0 &&
    form.iban.replace(/\s/g, "").length >= 10 &&
    form.gdpr && form.agreement &&
    !submitting;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const cc = form.countryCode.startsWith("+") ? form.countryCode : `+${form.countryCode}`;
      const res = await fetch("/api/public/teacher-register", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          name:           form.name.trim(),
          whatsapp_e164:  `${cc}${phoneDigits}`,
          whatsapp_raw:   `${cc} ${form.phone}`,
          address:        form.address.trim(),
          country:        form.country.toUpperCase(),
          languages:      form.languages.trim(),
          specialties:    form.specialties.trim(),
          levels:         form.levels,
          timezone:       form.timezone,
          availability:   form.franjas,
          photo_data_url: photoDataUrl ?? undefined,
          iban:           form.iban.replace(/\s/g, "").toUpperCase(),
          gdpr_accepted:  true,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setErr(data.message ?? data.error ?? "No se pudo enviar. Inténtalo de nuevo.");
        setSubmitting(false);
        return;
      }
      setDone(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error de conexión.");
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-center">
        <div className="text-4xl mb-2" aria-hidden>✅</div>
        <h2 className="text-lg font-bold text-emerald-800">¡Solicitud recibida!</h2>
        <p className="mt-2 text-sm text-emerald-700 leading-relaxed">
          Revisaremos tu perfil y te enviaremos un email con el enlace
          para crear tu contraseña. Suele tardar máximo 24 horas.
        </p>
        <Link
          href="https://aprender-aleman.de"
          className="mt-4 inline-block text-sm text-emerald-700 hover:underline"
        >
          ← Volver al sitio
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-7">
      {/* Condiciones acordadas — solo lectura */}
      <div className="rounded-2xl border-2 border-brand-200 bg-brand-50/60 p-5">
        <h2 className="text-sm font-bold uppercase tracking-wider text-brand-700 mb-2">
          Tus condiciones
        </h2>
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-800">
          {rateIndividual != null && (
            <span>💶 Tarifa individual: <strong>{rateIndividual}€/h</strong></span>
          )}
          <span>
            🏅 Rango de comisión: <strong>{RANGO_LABEL[rango] ?? rango}</strong>
            {comisionPct != null && <> ({comisionPct}%)</>}
          </span>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Acordadas con la academia — se aplican automáticamente a tu cuenta.
        </p>
      </div>

      <Section title="Datos personales">
        <Field label="Nombre completo *">
          <Input value={form.name} onChange={v => toggle("name", v)} placeholder="Sabine Arning" />
        </Field>
        <Field label="Email (será tu login)">
          <input
            type="email"
            value={invEmail}
            disabled
            className="w-full h-11 rounded-lg border border-slate-200 bg-slate-100 px-3 text-sm text-slate-500 cursor-not-allowed"
          />
          <p className="mt-1 text-xs text-slate-500">Fijado por tu invitación — no se puede cambiar.</p>
        </Field>
        <Field label="WhatsApp *">
          <div className="flex gap-2">
            <input
              type="tel"
              value={form.countryCode}
              onChange={e => toggle("countryCode", e.target.value.replace(/[^0-9+]/g, ""))}
              className="w-20 h-11 rounded-lg border border-slate-300 px-2 text-center text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              placeholder="+34"
            />
            <input
              type="tel"
              value={form.phone}
              onChange={e => toggle("phone", e.target.value)}
              className="flex-1 h-11 rounded-lg border border-slate-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              placeholder="611 22 33 44"
            />
          </div>
        </Field>
        <Field label="Dirección postal *">
          <Input value={form.address} onChange={v => toggle("address", v)} placeholder="Calle, número, ciudad, código postal" />
        </Field>
        <Field label="País de residencia *">
          <select
            value={form.country}
            onChange={e => toggle("country", e.target.value)}
            className="w-full h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            {COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Foto de perfil" hint="Opcional. Se mostrará en tu card de profesor. JPG/PNG/WebP, máx 2 MB.">
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={onPhotoChange}
            className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-100 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-brand-700 hover:file:bg-brand-200"
          />
          {photoErr && <p className="mt-1 text-xs text-red-600">{photoErr}</p>}
          {photoDataUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photoDataUrl} alt="Vista previa" className="mt-2 h-20 w-20 rounded-full object-cover border border-slate-200" />
          )}
        </Field>
      </Section>

      <Section title="Datos profesionales">
        <Field label="Idiomas que hablas *" hint="Escríbelos como prefieras. Ej: Alemán nativo, Español B2, Inglés C1">
          <textarea
            value={form.languages}
            onChange={e => toggle("languages", e.target.value)}
            rows={2}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </Field>
        <Field label="Especialidades *" hint="Áreas en las que tienes más experiencia. Ej: gramática A1-A2, conversación B1, preparación TELC B2">
          <textarea
            value={form.specialties}
            onChange={e => toggle("specialties", e.target.value)}
            rows={2}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </Field>
        <Field label="Niveles que enseñas *">
          <div className="flex flex-wrap gap-2">
            {LEVELS.map(l => {
              const on = form.levels.includes(l);
              return (
                <button
                  key={l}
                  type="button"
                  onClick={() => toggleLevel(l)}
                  className={[
                    "h-10 min-w-[3.5rem] px-3 rounded-lg text-sm font-semibold transition",
                    on
                      ? "bg-brand-500 text-white border border-brand-500"
                      : "bg-white text-slate-700 border border-slate-300 hover:border-brand-300",
                  ].join(" ")}
                >
                  {l}
                </button>
              );
            })}
          </div>
        </Field>
      </Section>

      <Section title="Agenda">
        <Field label="Zona horaria *" hint="Para mostrar tu agenda en tu hora local.">
          <select
            value={form.timezone}
            onChange={e => toggle("timezone", e.target.value)}
            className="w-full h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            {TIMEZONES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </Field>
        <Field label="Disponibilidad inicial" hint="Orientativa — la disponibilidad detallada la configuras luego en tu panel.">
          <div className="flex flex-wrap gap-2">
            {FRANJAS.map(fr => {
              const on = form.franjas.includes(fr.value);
              return (
                <button
                  key={fr.value}
                  type="button"
                  onClick={() => toggleFranja(fr.value)}
                  className={[
                    "h-11 px-4 rounded-lg text-sm font-semibold transition",
                    on
                      ? "bg-brand-500 text-white border border-brand-500"
                      : "bg-white text-slate-700 border border-slate-300 hover:border-brand-300",
                  ].join(" ")}
                  title={fr.hint}
                >
                  {fr.label}
                </button>
              );
            })}
          </div>
        </Field>
      </Section>

      <Section title="Datos de cobro">
        <Field label="IBAN para cobros *" hint="Tu cuenta bancaria. Solo accesible para la administración de la academia.">
          <Input value={form.iban} onChange={v => toggle("iban", v.toUpperCase())} placeholder="ES00 0000 0000 0000 0000 0000" />
        </Field>
      </Section>

      <Section title="Términos">
        <label className="flex items-start gap-3 cursor-pointer">
          <input type="checkbox" checked={form.gdpr} onChange={e => toggle("gdpr", e.target.checked)} className="mt-1 h-4 w-4 accent-brand-500" />
          <span className="text-sm text-slate-700 leading-relaxed">
            Acepto la <a href="https://www.aprender-aleman.de/datenschutz" target="_blank" rel="noopener noreferrer" className="text-brand-600 underline">política de privacidad</a>.
          </span>
        </label>
        <label className="flex items-start gap-3 cursor-pointer mt-2">
          <input type="checkbox" checked={form.agreement} onChange={e => toggle("agreement", e.target.checked)} className="mt-1 h-4 w-4 accent-brand-500" />
          <span className="text-sm text-slate-700 leading-relaxed">
            Acepto el acuerdo de colaboración con Aprender-Aleman.de (autónomo / freelance bajo las condiciones acordadas).
          </span>
        </label>
      </Section>

      {err && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {err}
        </div>
      )}

      <button
        type="submit"
        disabled={!canSubmit}
        className="w-full h-12 rounded-xl bg-brand-500 text-white font-semibold shadow-lg hover:bg-brand-600 disabled:opacity-50 disabled:cursor-not-allowed transition"
      >
        {submitting ? "Enviando…" : "Enviar solicitud"}
      </button>
      <p className="text-xs text-slate-500 text-center">
        Tu perfil queda pendiente de aprobación. Cuando la academia lo
        valide, te llegará un email con el enlace para crear tu contraseña.
      </p>
    </form>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-bold uppercase tracking-wider text-slate-500">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-semibold text-slate-800 mb-1">{label}</label>
      {hint && <p className="text-xs text-slate-500 mb-1.5">{hint}</p>}
      {children}
    </div>
  );
}

function Input({
  value, onChange, type = "text", placeholder,
}: {
  value:       string;
  onChange:    (v: string) => void;
  type?:       string;
  placeholder?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full h-11 rounded-lg border border-slate-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
    />
  );
}
