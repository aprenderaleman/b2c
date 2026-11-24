"use client";

import { useState } from "react";
import { combineE164 } from "@/components/diagnostico/DiagnosticoFunnel";
import { readAttribution } from "@/lib/ads-attribution";
import { trackFunnel } from "@/lib/track-funnel";

/**
 * Lista de espera del embudo de clase de prueba (Gelfis 2026-11-24).
 * Se muestra cuando no hay ningún hueco en los próximos 10 días
 * (TRIAL_HORIZON_DAYS). Guarda el lead vía /api/public/waitlist; no
 * envía mensajes automáticos — el equipo le escribe al abrir horario.
 */
export function WaitlistForm({
  landingIntent,
  profeSlug,
  profeName,
  defaultCountryCode = "+49",
  phonePlaceholder = "15253409644",
}: {
  landingIntent: string | null;
  profeSlug?: string | null;
  profeName?: string | null;
  defaultCountryCode?: string;
  phonePlaceholder?: string;
}) {
  const [name, setName]   = useState("");
  const [email, setEmail] = useState("");
  const [cc, setCc]       = useState(defaultCountryCode);
  const [phone, setPhone] = useState("");
  const [sending, setSending] = useState(false);
  const [done, setDone]   = useState(false);
  const [err, setErr]     = useState<string | null>(null);

  const e164 = combineE164(cc, phone);
  const phoneOk = /^\+\d{8,15}$/.test(e164) && phone.replace(/\D/g, "").length >= 6;
  const emailOk = email.trim() === "" || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
  const canSend = name.trim().length >= 2 && phoneOk && emailOk && !sending;

  const submit = async () => {
    if (!canSend) return;
    setSending(true);
    setErr(null);
    try {
      const attr = readAttribution();
      const res = await fetch("/api/public/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name:           name.trim(),
          email:          email.trim() ? email.trim().toLowerCase() : null,
          whatsapp_e164:  e164,
          whatsapp_raw:   `${cc.startsWith("+") ? cc : `+${cc}`} ${phone}`,
          landing_intent: landingIntent,
          ...attr,
          ...(profeSlug ? { profe: profeSlug } : {}),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        setErr(json.message ?? "No pudimos guardar tus datos. Inténtalo de nuevo.");
        return;
      }
      trackFunnel("waitlist_joined", { landingIntent: landingIntent ?? undefined });
      setDone(true);
    } catch {
      setErr("No pudimos guardar tus datos. Inténtalo de nuevo.");
    } finally {
      setSending(false);
    }
  };

  if (done) {
    return (
      <div className="rounded-2xl border border-emerald-300 bg-emerald-50 p-6 text-center">
        <p className="text-3xl mb-2">✅</p>
        <p className="text-[17px] font-bold text-emerald-900">¡Listo, {name.trim().split(/\s+/)[0]}!</p>
        <p className="mt-1 text-[15px] text-emerald-800 leading-snug">
          Estás en la lista de espera. Te escribimos por WhatsApp en cuanto se libere un horario para tu clase de prueba gratuita.
        </p>
      </div>
    );
  }

  const inputCls =
    "w-full h-12 px-4 rounded-xl bg-slate-50 ring-1 ring-inset ring-slate-200 text-slate-900 text-[16px] " +
    "focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:bg-white transition";

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-[17px] font-bold text-slate-900">
        {profeName
          ? `${profeName} y el resto de profesores están completos esta semana`
          : "Esta semana estamos completos"}
      </p>
      <p className="mt-1 text-[15px] text-slate-600 leading-snug">
        Déjanos tu WhatsApp y te avisamos en cuanto se libere un horario para tu clase de prueba gratuita.
      </p>

      <div className="mt-4 space-y-3">
        <div>
          <label className="block text-[13px] font-medium text-slate-700 mb-1">Tu nombre</label>
          <input value={name} onChange={e => setName(e.target.value)} className={inputCls} placeholder="Maria" autoComplete="given-name" />
        </div>
        <div>
          <label className="block text-[13px] font-medium text-slate-700 mb-1">WhatsApp</label>
          <div className="flex gap-2">
            <input
              type="tel" inputMode="tel" value={cc}
              onChange={e => setCc(e.target.value.replace(/[^0-9+]/g, ""))}
              className="w-[88px] h-12 px-3 rounded-xl bg-slate-50 ring-1 ring-inset ring-slate-200 text-slate-900 text-[16px] text-center font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:bg-white transition"
              placeholder="+49"
            />
            <input
              type="tel" inputMode="tel" autoComplete="tel" value={phone}
              onChange={e => setPhone(e.target.value)}
              className={inputCls} placeholder={phonePlaceholder}
            />
          </div>
        </div>
        <div>
          <label className="block text-[13px] font-medium text-slate-700 mb-1">
            Email <span className="text-slate-400 font-normal">(opcional)</span>
          </label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} className={inputCls} placeholder="tu@email.com" autoComplete="email" />
        </div>
      </div>

      {err && <p className="mt-3 text-sm text-red-600">{err}</p>}

      <button
        type="button"
        onClick={submit}
        disabled={!canSend}
        className="mt-4 w-full rounded-2xl bg-emerald-600 px-5 py-4 text-[17px] font-bold text-white
                   hover:bg-emerald-700 active:scale-[0.99] transition disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {sending ? "Guardando…" : "Avísame cuando haya horario"}
      </button>
      <p className="mt-2 text-center text-[12px] text-slate-500">Te contactaremos solo con fines educativos.</p>
    </div>
  );
}
