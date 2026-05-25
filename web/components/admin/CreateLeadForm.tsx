"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { COUNTRY_CODES } from "@/lib/phone";

const LEVELS = ["A0","A1.1","A1.2","A2.1","A2.2","B1","B2"] as const;
const SOURCES = ["manual","instagram","referido","email","llamada","otros"] as const;

export function CreateLeadForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [cc, setCc] = useState("+49");
  const [phoneLocal, setPhoneLocal] = useState("");
  const [language, setLanguage] = useState<"es"|"de">("es");
  const [level, setLevel] = useState<string>("A0");
  const [goal, setGoal] = useState("");
  const [source, setSource] = useState<typeof SOURCES[number]>("manual");
  const [note, setNote] = useState("");

  const submit = () => {
    setError(null);
    if (!name.trim()) { setError("Nombre obligatorio."); return; }
    if (!phoneLocal.trim()) { setError("WhatsApp obligatorio."); return; }

    startTransition(async () => {
      const body: Record<string, unknown> = {
        name: name.trim(),
        email: email.trim() || null,
        whatsapp_normalized: `${cc} ${phoneLocal.trim()}`,
        whatsapp_country: cc,
        language,
        german_level: level,
        goal: goal.trim() || null,
        source,
        initial_note: note.trim() || null,
      };
      const res = await fetch("/api/admin/leads/create", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.error === "lead_already_exists") {
          if (confirm(`${data.reason ?? "Ya existe"}\n\n¿Abrir ese lead?`)) router.push(`/admin/leads/${data.lead_id}`);
          return;
        }
        if (data.error === "phone_invalid") setError("WhatsApp inválido. Solo dígitos en el campo del número.");
        else setError(data.message || data.error || "Error creando el lead.");
        return;
      }
      router.push(`/admin/leads/${data.lead_id}`);
    });
  };

  return (
    <div className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4">
      <Field label="Nombre *">
        <input type="text" value={name} onChange={e=>setName(e.target.value)} className="input-text" placeholder="María García" />
      </Field>
      <Field label="Email (opcional)">
        <input type="email" value={email} onChange={e=>setEmail(e.target.value)} className="input-text" placeholder="lead@email.com" />
      </Field>
      <Field label="WhatsApp *">
        <div className="flex gap-2">
          <select value={cc} onChange={e=>setCc(e.target.value)} className="input-text w-32" aria-label="País">
            {COUNTRY_CODES.map(c => <option key={c.code} value={c.code}>{c.flag} {c.code}</option>)}
          </select>
          <input type="tel" inputMode="tel" value={phoneLocal} onChange={e=>setPhoneLocal(e.target.value)} className="input-text flex-1" placeholder="641 051 234" />
        </div>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Solo dígitos en el campo. El prefijo va en el selector.</p>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Idioma">
          <select value={language} onChange={e=>setLanguage(e.target.value as "es"|"de")} className="input-text">
            <option value="es">Español</option><option value="de">Deutsch</option>
          </select>
        </Field>
        <Field label="Nivel inicial">
          <select value={level} onChange={e=>setLevel(e.target.value)} className="input-text">
            {LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Meta / objetivo">
        <input type="text" value={goal} onChange={e=>setGoal(e.target.value)} className="input-text" placeholder="trabajo, viaje, estudios…" />
      </Field>
      <Field label="Origen del lead">
        <select value={source} onChange={e=>setSource(e.target.value as typeof SOURCES[number])} className="input-text">
          {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </Field>
      <Field label="Nota inicial (opcional)">
        <textarea value={note} onChange={e=>setNote(e.target.value)} className="input-text min-h-[70px]" placeholder="Contexto: cómo llegó, qué ha pedido, etc."/>
      </Field>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="flex justify-end pt-2">
        <button type="button" onClick={submit} disabled={pending} className="text-sm font-semibold px-4 py-2 rounded-xl bg-brand-500 hover:bg-brand-600 text-white disabled:opacity-50">
          {pending ? "Creando…" : "Crear lead"}
        </button>
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
