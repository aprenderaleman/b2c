"use client";

/**
 * "Registrar contacto" universal (spec sección 2d) — mismo componente para
 * closer, profe y admin. Máximo 2 taps + texto opcional:
 *
 *   tap 1: abrir → tap 2: elegir acción (canal/cuándo con defaults sanos)
 *
 * El actor sale de la sesión en el endpoint, nunca de aquí. nota_libre
 * exige >= 5 caracteres; "cuándo" permite hasta 48h atrás ("le escribí
 * anoche"). Los registros son inmutables — el modal lo avisa.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

const ACTIONS: Array<{ value: string; label: string }> = [
  { value: "nota_libre",          label: "💬 Contacto libre (con nota)" },
  { value: "agendar_prueba",      label: "📅 Agendar clase de prueba" },
  { value: "no_contesto",         label: "📵 No contestó" },
  { value: "enviar_info",         label: "📄 Envié información" },
  { value: "enviar_propuesta",    label: "📦 Envié propuesta" },
  { value: "seguimiento_pactado", label: "🤝 Seguimiento pactado" },
  { value: "enviar_enlace",       label: "🔗 Envié enlace de pago" },
  { value: "reactivacion",        label: "🔄 Reactivación" },
];

const CHANNELS: Array<{ value: string; label: string }> = [
  { value: "whatsapp", label: "WhatsApp" },
  { value: "llamada",  label: "Llamada" },
  { value: "email",    label: "Email" },
  { value: "aula",     label: "Aula" },
  { value: "otro",     label: "Otro" },
];

/** datetime-local (hora local del navegador) para value/min del input. */
function toLocalInputValue(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function RegistrarContactoButton({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [actionType, setActionType] = useState("nota_libre");
  const [channel, setChannel] = useState("whatsapp");
  const [note, setNote] = useState("");
  const [when, setWhen] = useState(""); // vacío = ahora
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const notaObligatoria = actionType === "nota_libre";
  const notaInvalida = notaObligatoria && note.trim().length < 5;

  async function save() {
    if (notaInvalida) { setError("La nota necesita al menos 5 caracteres."); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/contacts/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId,
          actionType,
          channel,
          note: note.trim() || undefined,
          occurredAt: when ? new Date(when).toISOString() : undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(
          data.error === "nota_corta" ? "La nota necesita al menos 5 caracteres."
          : data.error === "occurred_at_invalido" ? "La fecha debe estar entre hace 48h y ahora."
          : "No se pudo registrar. Inténtalo de nuevo.");
        return;
      }
      setOpen(false);
      setNote(""); setWhen(""); setActionType("nota_libre"); setChannel("whatsapp");
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  const now = new Date();
  const minWhen = toLocalInputValue(new Date(now.getTime() - 48 * 3_600_000));
  const maxWhen = toLocalInputValue(now);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-slate-100 px-3 py-1.5 text-[12.5px] font-semibold text-slate-700 hover:bg-slate-200 dark:border-white/15 dark:bg-white/5 dark:text-white/80 dark:hover:bg-white/10 dark:hover:text-white transition"
      >
        ➕ Registrar contacto
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => !saving && setOpen(false)}>
          <div
            className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-900 p-5 shadow-2xl text-white"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-bold text-white">Registrar contacto</h3>
            <p className="mt-0.5 text-[11.5px] text-white/45">
              Contacto real con el lead. Queda registrado y no se puede editar — si te equivocas, registra otro con la corrección.
            </p>

            <label className="mt-4 block text-[11px] uppercase tracking-wider text-white/45">Qué pasó</label>
            <select
              value={actionType}
              onChange={(e) => setActionType(e.target.value)}
              className="mt-1 w-full h-10 rounded-lg border border-white/10 bg-white/5 px-2 text-sm text-white"
            >
              {ACTIONS.map(a => <option key={a.value} value={a.value} className="bg-slate-900">{a.label}</option>)}
            </select>

            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] uppercase tracking-wider text-white/45">Canal</label>
                <select
                  value={channel}
                  onChange={(e) => setChannel(e.target.value)}
                  className="mt-1 w-full h-10 rounded-lg border border-white/10 bg-white/5 px-2 text-sm text-white"
                >
                  {CHANNELS.map(c => <option key={c.value} value={c.value} className="bg-slate-900">{c.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[11px] uppercase tracking-wider text-white/45">Cuándo</label>
                <input
                  type="datetime-local"
                  value={when}
                  min={minWhen}
                  max={maxWhen}
                  onChange={(e) => setWhen(e.target.value)}
                  className="mt-1 w-full h-10 rounded-lg border border-white/10 bg-white/5 px-2 text-sm text-white"
                />
                <div className="mt-0.5 text-[10px] text-white/35">Vacío = ahora · máx. 48h atrás</div>
              </div>
            </div>

            <label className="mt-3 block text-[11px] uppercase tracking-wider text-white/45">
              Nota {notaObligatoria ? "(obligatoria, mín. 5 caracteres)" : "(opcional)"}
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="Qué hablaron, qué quedó pendiente…"
              className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30"
            />

            {error && <div className="mt-2 text-[12px] text-red-300">{error}</div>}

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={() => setOpen(false)}
                className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/70 hover:text-white"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={saving || notaInvalida}
                onClick={save}
                className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-950 hover:bg-emerald-400 disabled:opacity-40"
              >
                {saving ? "Guardando…" : "Registrar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
