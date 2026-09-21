"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { COUNTRY_CODES } from "@/lib/phone";
import { GOAL_CLASSES, GOAL_LABELS, RITMOS, type GoalId, type RitmoId } from "@/lib/trial-packs";

const LEVELS = ["A1","A2","B1","B2","C1"] as const;
const SUB_TYPES = ["package","monthly_subscription","single_classes","combined"] as const;
const GOAL_IDS = Object.keys(GOAL_CLASSES) as GoalId[];

export function CreateStudentForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [cc, setCc] = useState("+49");
  const [phoneLocal, setPhoneLocal] = useState("");
  const [language, setLanguage] = useState<"es"|"de">("es");
  const [level, setLevel] = useState("A1");
  const [goal, setGoal] = useState<GoalId>("a1_a2");
  const [subType, setSubType] = useState<typeof SUB_TYPES[number]>("monthly_subscription");
  const [ritmo, setRitmo] = useState<RitmoId>("estandar");
  // Contrato según la meta del catálogo; editable solo para deals custom.
  const [classesPurchased, setClassesPurchased] = useState<number>(GOAL_CLASSES.a1_a2);
  const selectedRitmo = RITMOS.find(r => r.id === ritmo)!;
  const classesPerMonth = subType === "monthly_subscription" ? selectedRitmo.classesPerMonth : "";

  const submit = () => {
    setError(null);
    if (!name.trim()) { setError("Nombre obligatorio."); return; }
    if (!email.trim()) { setError("Email obligatorio."); return; }
    const phoneRaw = phoneLocal.trim() ? `${cc} ${phoneLocal.trim()}` : null;
    startTransition(async () => {
      const body: Record<string, unknown> = {
        full_name: name.trim(),
        email:     email.trim(),
        language_preference: language,
        current_level:       level,
        goal,
        subscription_type:   subType,
        classes_purchased:   classesPurchased,
      };
      if (phoneRaw) { body.phone = phoneRaw; body.phone_country = cc; }
      if (subType === "monthly_subscription" && classesPerMonth) body.classes_per_month = classesPerMonth;

      const res = await fetch("/api/admin/students/create", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.error === "email_used_by_other_role") setError(`El email ya pertenece a un ${data.reason ?? "usuario"}. No se puede usar.`);
        else if (data.error === "student_already_exists") { setError(""); router.push(`/admin/estudiantes/${data.student_id}`); }
        else if (data.error === "phone_invalid") setError("Teléfono inválido. Solo dígitos.");
        else setError(data.message || data.error || "Error creando el estudiante.");
        return;
      }
      router.push(`/admin/estudiantes/${data.student_id}`);
    });
  };

  return (
    <div className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4">
      <Field label="Nombre completo *">
        <input type="text" value={name} onChange={e=>setName(e.target.value)} className="input-text" placeholder="María García" />
      </Field>
      <Field label="Email *">
        <input type="email" value={email} onChange={e=>setEmail(e.target.value)} className="input-text" placeholder="alumno@email.com" />
      </Field>
      <Field label="Teléfono / WhatsApp (opcional)">
        <div className="flex gap-2">
          <select value={cc} onChange={e=>setCc(e.target.value)} className="input-text w-32" aria-label="País">
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
        <Field label="Nivel inicial">
          <select value={level} onChange={e=>setLevel(e.target.value)} className="input-text">
            {LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Meta (nivel al que llega)">
          <select
            value={goal}
            onChange={e => { const g = e.target.value as GoalId; setGoal(g); setClassesPurchased(GOAL_CLASSES[g]); }}
            className="input-text"
          >
            {GOAL_IDS.map(g => <option key={g} value={g}>{GOAL_LABELS[g]} · {GOAL_CLASSES[g]} clases</option>)}
          </select>
        </Field>
        <Field label="Clases del contrato">
          <input type="number" min={0} max={500} value={classesPurchased} onChange={e=>setClassesPurchased(Number(e.target.value))} className="input-text" />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Tipo de pago">
          <select value={subType} onChange={e=>setSubType(e.target.value as typeof SUB_TYPES[number])} className="input-text">
            <option value="monthly_subscription">Suscripción mensual</option>
            <option value="package">Pago único (paquete)</option>
            <option value="single_classes">Clases sueltas</option>
            <option value="combined">Combinado</option>
          </select>
        </Field>
        {subType === "monthly_subscription" && (
          <Field label="Ritmo">
            <select value={ritmo} onChange={e=>setRitmo(e.target.value as RitmoId)} className="input-text">
              {RITMOS.map(r => <option key={r.id} value={r.id}>{r.name} · {r.classesPerMonth} cl/mes · {r.pricePerMonth} €</option>)}
            </select>
          </Field>
        )}
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="flex justify-end pt-2">
        <button type="button" onClick={submit} disabled={pending} className="text-sm font-semibold px-4 py-2 rounded-xl bg-brand-500 hover:bg-brand-600 text-white disabled:opacity-50">
          {pending ? "Creando…" : "Crear estudiante"}
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
